package main

// Daily backups.
//   - Time (HH:MM), folder and number of copies to keep come from Settings > Backup in the app.
//   - PocketBase creates a consistent zip of the whole data folder; it is then copied to the
//     chosen folder (e.g. an external drive or a OneDrive/Google Drive synced folder).
//   - If the laptop was off at backup time, a catch-up backup runs a few minutes after start.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

const backupJob = "jw-daily-backup"

type BackupStatus struct {
	At      string `json:"at"`
	OK      bool   `json:"ok"`
	File    string `json:"file"`
	Copy    string `json:"copy"`
	Size    int64  `json:"size"`
	Error   string `json:"error"`
	Trigger string `json:"trigger"`
}

var backupMu sync.Mutex

func statusPath(app core.App) string { return filepath.Join(app.DataDir(), "backup-status.json") }

func readBackupStatus(app core.App) BackupStatus {
	var s BackupStatus
	if raw, err := os.ReadFile(statusPath(app)); err == nil {
		_ = json.Unmarshal(raw, &s)
	}
	return s
}

func backupSettings(app core.App) (dir string, hour, min, keep int) {
	set := settingsData(app)
	dir = str(set, "backupDir", "")
	if dir == "" {
		dir = filepath.Join(filepath.Dir(app.DataDir()), "backups")
	}
	hour, min = 21, 0
	fmt.Sscanf(str(set, "backupTime", "21:00"), "%d:%d", &hour, &min)
	if hour < 0 || hour > 23 || min < 0 || min > 59 {
		hour, min = 21, 0
	}
	keep = 30
	if v, ok := set["backupKeep"].(float64); ok && v >= 1 {
		keep = int(v)
	}
	return
}

func scheduleBackup(app core.App) {
	_, h, m, _ := backupSettings(app)
	app.Cron().Remove(backupJob)
	app.Cron().MustAdd(backupJob, fmt.Sprintf("%d %d * * *", m, h), func() {
		runBackup(app, "scheduled")
	})
}

func copyFile(src, dst string) (int64, error) {
	in, err := os.Open(src)
	if err != nil {
		return 0, err
	}
	defer in.Close()
	tmp := dst + ".part"
	out, err := os.Create(tmp)
	if err != nil {
		return 0, err
	}
	n, err := io.Copy(out, in)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmp)
		return 0, err
	}
	return n, os.Rename(tmp, dst)
}

// keep the newest `keep` jewellery-*.zip files in dir
func prune(dir string, keep int) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), "jewellery-") && strings.HasSuffix(e.Name(), ".zip") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names) // names carry a sortable timestamp
	for len(names) > keep {
		os.Remove(filepath.Join(dir, names[0]))
		names = names[1:]
	}
}

func runBackup(app core.App, trigger string) BackupStatus {
	backupMu.Lock()
	defer backupMu.Unlock()
	st := BackupStatus{At: time.Now().Format(time.RFC3339), Trigger: trigger}
	dir, _, _, keep := backupSettings(app)
	name := "jewellery-" + time.Now().Format("20060102-150405") + ".zip"
	err := app.CreateBackup(context.Background(), name)
	if err == nil {
		st.File = name
		src := filepath.Join(app.DataDir(), core.LocalBackupsDirName, name)
		if err = os.MkdirAll(dir, 0o755); err == nil {
			dst := filepath.Join(dir, name)
			st.Size, err = copyFile(src, dst)
			st.Copy = dst
		}
		prune(filepath.Join(app.DataDir(), core.LocalBackupsDirName), 3) // a few local copies only
		if err == nil {
			prune(dir, keep)
		}
	}
	if err != nil {
		st.Error = err.Error()
		app.Logger().Error("Backup failed", "error", err)
	} else {
		st.OK = true
		app.Logger().Info("Backup created", "file", st.Copy)
	}
	raw, _ := json.MarshalIndent(st, "", " ")
	_ = os.WriteFile(statusPath(app), raw, 0o644)
	return st
}

func isMasterUser(e *core.RequestEvent, roles ...string) bool {
	if e.Auth == nil || e.Auth.Collection().Name != staffCollection || !e.Auth.GetBool("active") || !e.Auth.GetBool("isMaster") {
		return false
	}
	if len(roles) == 0 {
		return true
	}
	for _, r := range roles {
		if e.Auth.GetString("role") == r {
			return true
		}
	}
	return false
}

func registerBackups(app core.App) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		scheduleBackup(e.App)

		// catch up if the last successful backup is older than a day (laptop was off)
		go func() {
			time.Sleep(3 * time.Minute)
			last := readBackupStatus(e.App)
			t, err := time.Parse(time.RFC3339, last.At)
			if err != nil || !last.OK || time.Since(t) > 26*time.Hour {
				runBackup(e.App, "catch-up")
			}
		}()

		e.Router.GET("/api/jw/backup", func(re *core.RequestEvent) error {
			if !isMasterUser(re, "Admin", "Manager") {
				return re.ForbiddenError("Only head office Admin / Manager can see backups.", nil)
			}
			dir, h, m, keep := backupSettings(re.App)
			var files []map[string]any
			if entries, err := os.ReadDir(dir); err == nil {
				for _, f := range entries {
					if info, err := f.Info(); err == nil && strings.HasPrefix(f.Name(), "jewellery-") {
						files = append(files, map[string]any{"name": f.Name(), "size": info.Size(), "modified": info.ModTime().Format(time.RFC3339)})
					}
				}
			}
			return re.JSON(http.StatusOK, map[string]any{
				"dir": dir, "time": fmt.Sprintf("%02d:%02d", h, m), "keep": keep, "last": readBackupStatus(re.App), "files": files,
			})
		}).Bind(apis.RequireAuth(staffCollection))

		e.Router.POST("/api/jw/backup", func(re *core.RequestEvent) error {
			if !isMasterUser(re, "Admin") {
				return re.ForbiddenError("Only head office Admin can start a backup.", nil)
			}
			st := runBackup(re.App, "manual by "+re.Auth.GetString("username"))
			if !st.OK {
				return re.BadRequestError("Backup failed: "+st.Error, nil)
			}
			return re.JSON(http.StatusOK, st)
		}).Bind(apis.RequireAuth(staffCollection))
		return e.Next()
	})

	// Backup time or folder changed in Settings: reschedule
	app.OnRecordAfterUpdateSuccess("appSettings").BindFunc(func(e *core.RecordEvent) error {
		scheduleBackup(e.App)
		return e.Next()
	})
}
