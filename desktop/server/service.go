package main

// Windows service: the installer runs "jewellery-server service install" and "service start".
// The service is set to start automatically when Windows starts; Windows stops it (gracefully,
// closing the database) when the laptop shuts down.

import (
	"archive/zip"
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
	log.Println("JewelleryApp database starting on", p.cfg.HttpAddr, "data:", p.cfg.DataDir)
	if err := apis.Serve(p.app, apis.ServeConfig{HttpAddr: p.cfg.HttpAddr}); err != nil && !errors.Is(err, http.ErrServerClosed) {
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

// restoreBackup replaces the data folder with the contents of a backup zip.
// The current data folder is kept as <dataDir>-before-restore-<time>.
func restoreBackup(cfg Config, file string) error {
	if serverRunning(cfg) {
		return errors.New("the JewelleryApp database is running. Stop it first: jewellery-server service stop")
	}
	zr, err := zip.OpenReader(file)
	if err != nil {
		return fmt.Errorf("cannot open backup: %w", err)
	}
	defer zr.Close()
	hasDB := false
	for _, f := range zr.File {
		if f.Name == "data.db" {
			hasDB = true
		}
	}
	if !hasDB {
		return errors.New("this zip is not a JewelleryApp backup (data.db missing)")
	}
	old := cfg.DataDir + "-before-restore-" + time.Now().Format("20060102-150405")
	if _, err := os.Stat(cfg.DataDir); err == nil {
		if err := os.Rename(cfg.DataDir, old); err != nil {
			return fmt.Errorf("cannot move the current data aside: %w", err)
		}
	}
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return err
	}
	for _, f := range zr.File {
		dst := filepath.Join(cfg.DataDir, filepath.FromSlash(f.Name))
		if !strings.HasPrefix(dst, filepath.Clean(cfg.DataDir)+string(os.PathSeparator)) {
			return fmt.Errorf("unsafe path in backup: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			os.MkdirAll(dst, 0o755)
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
			return err
		}
	}
	fmt.Println("Restored", file)
	fmt.Println("Previous data kept in", old)
	fmt.Println("Now start the database: jewellery-server service start")
	return nil
}
