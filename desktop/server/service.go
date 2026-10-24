package main

// Windows service: the installer runs "jewellery-server service install" and "service start".
// The service is set to start automatically when Windows starts; Windows stops it (gracefully,
// closing the database) when the laptop shuts down.

import (
	"archive/zip"
	"bufio"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/kardianos/service"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

const serviceName = "JewelleryAppDB"

type program struct {
	cfg Config
	app *pocketbase.PocketBase
}

func (p *program) Start(s service.Service) error {
	go p.run()
	return nil
}

func (p *program) run() {
	logFile := openServiceLog(p.cfg)
	if logFile != nil {
		log.SetOutput(logFile)
	}
	p.app = newApp(p.cfg)
	if err := p.app.Bootstrap(); err != nil {
		log.Println("bootstrap failed:", err)
		os.Exit(1)
	}
	log.Println("JewelleryApp database starting on", p.cfg.HttpAddr, p.cfg.HttpsAddr, "data:", p.cfg.DataDir)
	if err := serveApp(p.app, p.cfg); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Println("server stopped with error:", err)
		os.Exit(1)
	}
}

// Stop shuts the web server down and closes the database cleanly.
func (p *program) Stop(s service.Service) error {
	if p.app == nil {
		return nil
	}
	log.Println("JewelleryApp database stopping")
	event := new(core.TerminateEvent)
	event.App = p.app
	return p.app.OnTerminate().Trigger(event, func(e *core.TerminateEvent) error {
		return e.App.ClearBootstrap()
	})
}

func openServiceLog(cfg Config) *os.File {
	dir := filepath.Join(filepath.Dir(cfg.DataDir), "logs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil
	}
	f, err := os.OpenFile(filepath.Join(dir, "server.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return nil
	}
	return f
}

func newService(cfg Config) (service.Service, *program, error) {
	prg := &program{cfg: cfg}
	s, err := service.New(prg, &service.Config{
		Name:        serviceName,
		DisplayName: "JewelleryApp Database",
		Description: "Database and app server for JewelleryApp. Starts with Windows; stopped automatically at shutdown.",
		Arguments:   []string{"run-service"},
		Option: service.KeyValue{
			"StartType":              "automatic",
			"OnFailure":              "restart",
			"OnFailureDelayDuration": "10s",
			"OnFailureResetPeriod":   86400,
		},
	})
	return s, prg, err
}

func runService(cfg Config) {
	s, _, err := newService(cfg)
	if err != nil {
		log.Fatal(err)
	}
	if err := s.Run(); err != nil {
		log.Fatal(err)
	}
}

func serviceCommand(cfg Config, args []string) error {
	if len(args) == 0 {
		return errors.New("use: service install | uninstall | start | stop | restart | status")
	}
	s, _, err := newService(cfg)
	if err != nil {
		return err
	}
	switch args[0] {
	case "status":
		st, err := s.Status()
		if err != nil {
			return err
		}
		fmt.Println(map[service.Status]string{service.StatusRunning: "running", service.StatusStopped: "stopped"}[st])
		return nil
	case "install", "uninstall", "start", "stop", "restart":
		if err := service.Control(s, args[0]); err != nil {
			return err
		}
		fmt.Println("service", args[0], "done")
		return nil
	}
	return fmt.Errorf("unknown service action %q", args[0])
}

// serveApp runs the web server: HTTPS for every device (with the shop's own certificate) and
// plain HTTP for the server laptop itself plus the device setup page.
func serveApp(app *pocketbase.PocketBase, cfg Config) error {
	if strings.EqualFold(cfg.HttpsAddr, "off") {
		return apis.Serve(app, apis.ServeConfig{HttpAddr: cfg.HttpAddr, AllowedOrigins: allowedOrigins(cfg)})
	}
	shop, err := newShopTLS(filepath.Dir(filepath.Clean(cfg.DataDir)))
	if err != nil {
		return fmt.Errorf("could not prepare the HTTPS certificate: %w", err)
	}
	shopCert = shop
	app.OnServe().Bind(&hook.Handler[*core.ServeEvent]{
		Priority: 1000,
		Func: func(e *core.ServeEvent) error {
			e.Server.TLSConfig = shop.TLSConfig()
			if err := e.Next(); err != nil { // builds the routes and opens the HTTPS listener
				return err
			}
			if cfg.HttpAddr != "" {
				plain := &http.Server{
					Addr:              cfg.HttpAddr,
					Handler:           shop.httpHandler(e.Server.Handler, portOf(cfg.HttpsAddr, "8443")),
					ReadHeaderTimeout: time.Minute,
				}
				go func() {
					if err := plain.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
						e.App.Logger().Error("HTTP listener stopped", "error", err)
					}
				}()
				e.App.OnTerminate().BindFunc(func(te *core.TerminateEvent) error {
					plain.Close()
					return te.Next()
				})
			}
			return nil
		},
	})
	return apis.Serve(app, apis.ServeConfig{HttpsAddr: cfg.HttpsAddr, AllowedOrigins: allowedOrigins(cfg)})
}

// shopCert is set while serving over HTTPS (used by the network / setup routes)
var shopCert *shopTLS

// ---- restore ----

func serverRunning(cfg Config) bool {
	addr := localAddr(cfg.HttpAddr)
	c := &http.Client{Timeout: 2 * time.Second}
	res, err := c.Get("http://" + addr + "/api/jw/health")
	if err != nil {
		return false
	}
	res.Body.Close()
	return true
}

// restoreBackup replaces the data folder with the contents of a backup (.zip or encrypted
// .jwbackup). The backup is unpacked and checked FIRST; the current data is only moved aside
// (to <dataDir>-before-restore-<time>) once the backup is known to be a good JewelleryApp database.
// If anything fails, the current data is left exactly as it was.
func restoreBackup(cfg Config, file, password string) error {
	if serverRunning(cfg) {
		return errors.New("the JewelleryApp database is running. Stop it first: jewellery-server service stop")
	}
	if _, err := os.Stat(file); err != nil {
		return fmt.Errorf("cannot open backup: %w", err)
	}
	stamp := time.Now().Format("20060102-150405.000")
	parent := filepath.Dir(filepath.Clean(cfg.DataDir))
	zipPath := file

	// 1. encrypted backup: decrypt to a temporary zip
	if isEncryptedBackup(file) {
		if password == "" {
			fmt.Print("Backup password: ")
			line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
			password = strings.TrimRight(line, "\r\n")
		}
		zipPath = filepath.Join(parent, "restore-"+stamp+".zip")
		defer os.Remove(zipPath)
		if err := decryptFile(file, zipPath, password); err != nil {
			return err
		}
	}

	// 2. unpack into a temporary folder next to the data folder
	tmp := filepath.Clean(cfg.DataDir) + "-restoring-" + stamp
	defer os.RemoveAll(tmp) // removed if anything below fails (after success it no longer exists)
	if err := unzipTo(zipPath, tmp); err != nil {
		return err
	}

	// 3. check it is a sound JewelleryApp database
	if err := checkDatabase(filepath.Join(tmp, "data.db")); err != nil {
		return fmt.Errorf("this backup cannot be used (%v). Your current data has not been changed", err)
	}

	// 4. swap the folders
	old := filepath.Clean(cfg.DataDir) + "-before-restore-" + stamp
	hadData := false
	if _, err := os.Stat(cfg.DataDir); err == nil {
		if err := os.Rename(cfg.DataDir, old); err != nil {
			return fmt.Errorf("cannot move the current data aside (is the database or a file in it open?): %w", err)
		}
		hadData = true
	}
	if err := os.Rename(tmp, cfg.DataDir); err != nil {
		if hadData {
			_ = os.Rename(old, cfg.DataDir) // put the current data back
		}
		return fmt.Errorf("cannot put the restored data in place: %w. Your current data has not been changed", err)
	}
	fmt.Println("Restored", file)
	if hadData {
		fmt.Println("Previous data kept in", old)
	}
	fmt.Println("If this backup came from another laptop, enter the Razorpay and WhatsApp keys again in Settings.")
	fmt.Println("Now start the database: jewellery-server service start")
	return nil
}

func unzipTo(zipPath, dir string) error {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("cannot open backup: %w", err)
	}
	defer zr.Close()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	root := filepath.Clean(dir) + string(os.PathSeparator)
	for _, f := range zr.File {
		dst := filepath.Join(dir, filepath.FromSlash(f.Name))
		if !strings.HasPrefix(dst, root) {
			return fmt.Errorf("unsafe path in backup: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(dst, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.Create(dst)
		if err != nil {
			rc.Close()
			return err
		}
		_, err = io.Copy(out, rc)
		rc.Close()
		out.Close()
		if err != nil {
			return fmt.Errorf("backup is damaged: %w", err)
		}
	}
	return nil
}

// checkDatabase opens the restored database read-only and checks it is intact and is JewelleryApp's
func checkDatabase(path string) error {
	if _, err := os.Stat(path); err != nil {
		return errors.New("data.db is missing, this is not a JewelleryApp backup")
	}
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(path)+"?mode=ro")
	if err != nil {
		return err
	}
	defer db.Close()
	var res string
	if err := db.QueryRow("PRAGMA integrity_check").Scan(&res); err != nil {
		return fmt.Errorf("data.db is not a valid database: %v", err)
	}
	if res != "ok" {
		return fmt.Errorf("data.db is damaged: %s", res)
	}
	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM _collections WHERE name IN ('staff','invoices','stock','customers')").Scan(&n); err != nil || n < 4 {
		return errors.New("data.db is not a JewelleryApp database")
	}
	return nil
}
