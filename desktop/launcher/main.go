// JewelleryApp.exe: opens the app in its own window (Microsoft Edge or Chrome "app" mode, no
// address bar) once the JewelleryApp Database service answers. Built with -H=windowsgui.
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type config struct {
	HttpAddr string `json:"httpAddr"`
}

func exeDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
}

// appURL reads the address from jewellery.json (written by the installer next to both programs)
func appURL() string {
	cfg := config{HttpAddr: "127.0.0.1:8090"}
	if raw, err := os.ReadFile(filepath.Join(exeDir(), "jewellery.json")); err == nil {
		_ = json.Unmarshal(raw, &cfg)
	}
	addr := cfg.HttpAddr
	if strings.HasPrefix(addr, "0.0.0.0") || strings.HasPrefix(addr, ":") {
		addr = "127.0.0.1" + addr[strings.Index(addr, ":"):]
	}
	return "http://" + addr
}

func healthy(url string) bool {
	c := &http.Client{Timeout: 2 * time.Second}
	res, err := c.Get(url + "/api/jw/health")
	if err != nil {
		return false
	}
	res.Body.Close()
	return res.StatusCode == http.StatusOK
}

func browsers() []string {
	var list []string
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LocalAppData"} {
		base := os.Getenv(env)
		if base == "" {
			continue
		}
		list = append(list,
			filepath.Join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
			filepath.Join(base, "Google", "Chrome", "Application", "chrome.exe"))
	}
	return list
}

func main() {
	url := appURL()
	// Right after Windows starts the service may still be starting: wait up to 40 seconds
	ok := false
	for i := 0; i < 20; i++ {
		if healthy(url) {
			ok = true
			break
		}
		time.Sleep(2 * time.Second)
	}
	if !ok {
		messageBox("JewelleryApp",
			"The JewelleryApp database is not running.\n\n"+
				"Open Windows Services (press Win+R, type services.msc), find \"JewelleryApp Database\" and click Start, "+
				"or restart the laptop.\n\nIf it still does not start, see C:\\ProgramData\\JewelleryApp\\logs\\server.log.", true)
		os.Exit(1)
	}

	profile := filepath.Join(os.Getenv("LocalAppData"), "JewelleryApp", "window")
	for _, b := range browsers() {
		if _, err := os.Stat(b); err != nil {
			continue
		}
		cmd := exec.Command(b, "--app="+url, "--user-data-dir="+profile, "--no-first-run",
			"--no-default-browser-check", "--window-size=1366,860", "--disable-features=Translate")
		if err := cmd.Start(); err == nil {
			return
		}
	}
	// No Edge / Chrome found: use the default browser
	if err := openDefault(url); err != nil {
		messageBox("JewelleryApp", fmt.Sprintf("Open this address in your browser:\n\n%s", url), false)
	}
}
