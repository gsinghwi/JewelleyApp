// JewelleryApp.exe: the desktop / Start menu shortcut. Waits until the JewelleryApp Database
// service answers, then opens http://localhost:8090 in the default web browser.
// (Other devices on the Wi-Fi just open http://<laptop IP>:8090 in their browser.) Built with -H=windowsgui.
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
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
	cfg := config{HttpAddr: "0.0.0.0:8090"}
	if raw, err := os.ReadFile(filepath.Join(exeDir(), "jewellery.json")); err == nil {
		_ = json.Unmarshal(raw, &cfg)
	}
	addr := cfg.HttpAddr
	if strings.HasPrefix(addr, "0.0.0.0") || strings.HasPrefix(addr, ":") || strings.HasPrefix(addr, "127.0.0.1") {
		addr = "localhost" + addr[strings.LastIndex(addr, ":"):]
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

	if err := openDefault(url); err != nil {
		messageBox("JewelleryApp", fmt.Sprintf("Open this address in your browser:\n\n%s", url), false)
	}
}
