package main

// Using the app from other laptops / tablets on the shop Wi-Fi.
// The server listens on all network cards (0.0.0.0:8090) so any device on the same network can
// open http://<this laptop's IP>:8090. The PocketBase admin pages and superuser-only APIs are
// only answered for requests coming from this laptop itself.

import (
	"net"
	"net/http"
	"os"
	"sort"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// paths only usable from the server laptop
var localOnlyPrefixes = []string{"/_/", "/api/collections/_superusers", "/api/settings", "/api/logs",
	"/api/backups", "/api/crons", "/api/collections/import"}

func isLoopback(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// lanURLs lists the addresses other devices can use, e.g. http://192.168.1.50:8090
func lanURLs(httpAddr string) (urls []string, hostname string) {
	_, port, err := net.SplitHostPort(httpAddr)
	if err != nil {
		port = "8090"
	}
	hostname, _ = os.Hostname()
	var private, other []string
	ifaces, _ := net.Interfaces()
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok || ipn.IP.To4() == nil || ipn.IP.IsLinkLocalUnicast() {
				continue
			}
			u := "http://" + ipn.IP.String() + ":" + port
			if ipn.IP.IsPrivate() { // 192.168.x.x, 10.x.x.x, 172.16-31.x.x: the usual shop Wi-Fi
				private = append(private, u)
			} else {
				other = append(other, u)
			}
		}
	}
	urls = private
	if len(urls) == 0 {
		urls = other
	}
	sort.Strings(urls)
	return urls, hostname
}

func lanEnabled(httpAddr string) bool {
	host, _, err := net.SplitHostPort(httpAddr)
	if err != nil {
		return false
	}
	return host == "" || host == "0.0.0.0" || host == "::" || !net.ParseIP(host).IsLoopback()
}

func registerNetwork(app core.App, cfg Config) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.BindFunc(func(re *core.RequestEvent) error {
			p := re.Request.URL.Path
			if !isLoopback(re.Request) {
				for _, pre := range localOnlyPrefixes {
					if strings.HasPrefix(p, pre) {
						return re.ForbiddenError("Only available on the server laptop itself.", nil)
					}
				}
				// the superuser account by any name or id, and any superuser token
				if strings.HasPrefix(p, "/api/collections/") {
					seg := strings.SplitN(strings.TrimPrefix(p, "/api/collections/"), "/", 2)[0]
					if c, err := re.App.FindCachedCollectionByNameOrId(seg); err == nil && c.Name == core.CollectionNameSuperusers {
						return re.ForbiddenError("Only available on the server laptop itself.", nil)
					}
				}
				if re.HasSuperuserAuth() {
					return re.ForbiddenError("Only available on the server laptop itself.", nil)
				}
			}
			// a user who must change their password can do nothing else until they have
			if re.Auth != nil && re.Auth.Collection().Name == staffCollection && re.Auth.GetBool("mustChangePassword") && !requestAllowedBeforePasswordChange(re) {
				return re.ForbiddenError("Change your password first.", nil)
			}
			return re.Next()
		})

		e.Router.GET("/api/jw/network", func(re *core.RequestEvent) error {
			urls, host := lanURLs(cfg.HttpAddr)
			port := "8090"
			if _, p, err := net.SplitHostPort(cfg.HttpAddr); err == nil {
				port = p
			}
			byName := ""
			if host != "" {
				byName = "http://" + strings.ToLower(host) + ":" + port
			}
			return re.JSON(http.StatusOK, map[string]any{
				"lanEnabled": lanEnabled(cfg.HttpAddr), "listen": cfg.HttpAddr,
				"urls": urls, "byName": byName, "local": "http://localhost:" + port,
			})
		}).Bind(apis.RequireAuth(staffCollection))
		return e.Next()
	})
}
