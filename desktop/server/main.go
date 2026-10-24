// JewelleryApp server: PocketBase (database, logins, API) + the JewelleryApp web UI,
// daily backups, server-side integrations and a MySQL export, in one executable.
//
//	jewellery-server                     start the server (same as "serve")
//	jewellery-server service install     register the Windows service (auto start at boot)
//	jewellery-server service start|stop|uninstall|status
//	jewellery-server export-mysql --out data.sql
//	jewellery-server backup              create a backup now (service must be stopped, or use the app)
//	jewellery-server restore --file backup.zip|.jwbackup [--password X]   (service must be stopped)
//	jewellery-server superuser upsert EMAIL PASS (PocketBase dashboard login)
package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

var version = "1.0.0" // set at build time: -ldflags "-X main.version=..."

//go:embed all:web
var webFS embed.FS

// Config is read from jewellery.json next to the executable (created by the installer).
type Config struct {
	HttpAddr string `json:"httpAddr"` // 0.0.0.0:8090 = this laptop and other devices on the shop Wi-Fi; 127.0.0.1:8090 = this laptop only
	DataDir  string `json:"dataDir"`
}

func exeDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
}

func defaultDataDir() string {
	if runtime.GOOS == "windows" {
		if pd := os.Getenv("ProgramData"); pd != "" {
			return filepath.Join(pd, "JewelleryApp", "pb_data")
		}
	}
	return filepath.Join(exeDir(), "pb_data")
}

func loadConfig() Config {
	cfg := Config{HttpAddr: "0.0.0.0:8090", DataDir: defaultDataDir()}
	if raw, err := os.ReadFile(filepath.Join(exeDir(), "jewellery.json")); err == nil {
		_ = json.Unmarshal(raw, &cfg)
	}
	if env := os.Getenv("JEWELLERY_DATA_DIR"); env != "" {
		cfg.DataDir = env
	}
	if env := os.Getenv("JEWELLERY_HTTP"); env != "" {
		cfg.HttpAddr = env
	}
	return cfg
}

func saveConfig(cfg Config) error {
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(exeDir(), "jewellery.json"), raw, 0o644)
}

// address to reach the server from this computer
func localAddr(addr string) string {
	if strings.HasPrefix(addr, "0.0.0.0") || strings.HasPrefix(addr, ":") {
		return "127.0.0.1" + addr[strings.Index(addr, ":"):]
	}
	return addr
}

func nowDate() string { return time.Now().Format("2006-01-02") }

func newApp(cfg Config) *pocketbase.PocketBase {
	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: cfg.DataDir, HideStartBanner: false})

	registerHooks(app)
	registerSecurity(app)
	registerBusinessRules(app)
	registerAudit(app)

	// Prepare the database before serving: collections, default data, first superuser
	app.OnServe().Bind(&hook.Handler[*core.ServeEvent]{
		Priority: -100,
		Func: func(e *core.ServeEvent) error {
			if err := setupDatabase(e.App); err != nil {
				return err
			}
			return e.Next()
		},
	})

	registerBackups(app)
	registerIntegrations(app)
	registerExportRoutes(app)
	registerNetwork(app, cfg)

	// The JewelleryApp UI, served at http://<laptop>:8090/
	app.OnServe().Bind(&hook.Handler[*core.ServeEvent]{
		Priority: 999,
		Func: func(e *core.ServeEvent) error {
			sub, _ := fs.Sub(webFS, "web")
			e.Router.GET("/api/jw/health", func(re *core.RequestEvent) error {
				return re.JSON(http.StatusOK, map[string]any{"ok": true, "version": version})
			})
			if !e.Router.HasRoute(http.MethodGet, "/{path...}") {
				e.Router.GET("/{path...}", apis.Static(sub, true))
			}
			return e.Next()
		},
	})
	return app
}

func setupDatabase(app core.App) error {
	if err := ensureSchema(app); err != nil {
		return err
	}
	if err := seedIfEmpty(app); err != nil {
		return err
	}
	if err := ensureSuperuser(app); err != nil {
		return err
	}
	protectAtRest(app)
	return nil
}

// The PocketBase dashboard (/_/) needs a superuser. One is created on first start with a random
// password written to <data folder>/superuser-login.txt, outside the database folder so it is
// never inside a backup (only readable on this computer).
func ensureSuperuser(app core.App) error {
	col, err := app.FindCachedCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		return err
	}
	total, err := app.CountRecords(col)
	if err != nil || total > 0 {
		return err
	}
	buf := make([]byte, 12)
	_, _ = rand.Read(buf)
	pass := hex.EncodeToString(buf)
	r := core.NewRecord(col)
	r.SetEmail("admin@jewelleryapp.local")
	r.SetPassword(pass)
	if err := app.Save(r); err != nil {
		return err
	}
	note := "PocketBase dashboard (advanced, for support only): http://" + localAddr(loadConfig().HttpAddr) + "/_/\r\n" +
		"Email:    admin@jewelleryapp.local\r\nPassword: " + pass + "\r\n" +
		"Change it from the dashboard after the first login.\r\n"
	return os.WriteFile(superuserNotePath(app), []byte(note), 0o600)
}

func main() {
	cfg := loadConfig()

	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "service":
			if err := serviceCommand(cfg, os.Args[2:]); err != nil {
				fmt.Fprintln(os.Stderr, "error:", err)
				os.Exit(1)
			}
			return
		case "run-service":
			runService(cfg)
			return
		case "restore":
			file, password := "", ""
			for i := 2; i < len(os.Args); i++ {
				switch {
				case strings.HasPrefix(os.Args[i], "--file="):
					file = strings.TrimPrefix(os.Args[i], "--file=")
				case os.Args[i] == "--file" && i+1 < len(os.Args):
					file = os.Args[i+1]
				case strings.HasPrefix(os.Args[i], "--password="):
					password = strings.TrimPrefix(os.Args[i], "--password=")
				case os.Args[i] == "--password" && i+1 < len(os.Args):
					password = os.Args[i+1]
				}
			}
			if file == "" {
				fmt.Fprintln(os.Stderr, "use: jewellery-server restore --file <backup.zip | backup.jwbackup> [--password <backup password>]")
				os.Exit(1)
			}
			if err := restoreBackup(cfg, file, password); err != nil {
				fmt.Fprintln(os.Stderr, "error:", err)
				os.Exit(1)
			}
			return
		case "config":
			// used by the installer: jewellery-server config --data-dir <folder> --http 127.0.0.1:8090
			for i := 2; i+1 < len(os.Args); i++ {
				switch os.Args[i] {
				case "--data-dir":
					cfg.DataDir = os.Args[i+1]
				case "--http":
					cfg.HttpAddr = os.Args[i+1]
				}
			}
			if err := saveConfig(cfg); err != nil {
				fmt.Fprintln(os.Stderr, "error:", err)
				os.Exit(1)
			}
			fmt.Println("saved", filepath.Join(exeDir(), "jewellery.json"))
			return
		case "version", "--version":
			fmt.Println("jewellery-server", version)
			return
		}
	}

	app := newApp(cfg)
	app.RootCmd.Use = "jewellery-server"
	app.RootCmd.Short = "JewelleryApp database and app server"
	registerCommands(app)

	// No command given: start the server on the configured address
	if len(os.Args) == 1 {
		os.Args = append(os.Args, "serve", "--http", cfg.HttpAddr)
	}

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
