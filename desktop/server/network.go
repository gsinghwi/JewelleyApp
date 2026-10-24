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
			// a disabled login is refused straight away, even with a token issued before it was disabled
			if re.Auth != nil && re.Auth.Collection().Name == staffCollection && !re.Auth.GetBool("active") &&
				p != "/api/jw/health" && !strings.HasPrefix(p, "/api/collections/"+staffCollection+"/auth-with-password") {
				return re.ForbiddenError("This login is disabled. Ask the head office Admin.", nil)
			}
			// a user who must change their password can do nothing else until they have
			if re.Auth != nil && re.Auth.Collection().Name == staffCollection && re.Auth.GetBool("mustChangePassword") && !requestAllowedBeforePasswordChange(re) {
				return re.ForbiddenError("Change your password first.", nil)
			}
			return re.Next()
		})

		e.Router.GET("/api/jw/network", func(re *core.RequestEvent) error {
			httpPort := portOf(cfg.HttpAddr, "8090")
			out := map[string]any{"local": "http://localhost:" + httpPort}
			if shopCert == nil { // HTTPS switched off
				urls, host := lanURLs(cfg.HttpAddr)
				out["https"], out["lanEnabled"], out["listen"], out["urls"] = false, lanEnabled(cfg.HttpAddr), cfg.HttpAddr, urls
				if host != "" {
					out["byName"] = "http://" + strings.ToLower(host) + ":" + httpPort
				}
				return re.JSON(http.StatusOK, out)
			}
			urls, host := lanURLs(cfg.HttpsAddr)
			var setup []string
			for i, u := range urls { // u is http://<ip>:<https port>
				ip := strings.TrimSuffix(strings.TrimPrefix(u, "http://"), ":"+portOf(cfg.HttpsAddr, "8443"))
				urls[i] = "https://" + ip + ":" + portOf(cfg.HttpsAddr, "8443")
				setup = append(setup, "http://"+ip+":"+httpPort+"/setup")
			}
			out["https"], out["lanEnabled"], out["listen"], out["urls"], out["setup"] = true, lanEnabled(cfg.HttpsAddr), cfg.HttpsAddr, urls, setup
			out["fingerprint"], out["caName"] = shopCert.Fingerprint(), shopCert.CAName()
			if host != "" {
				out["byName"] = "https://" + strings.ToLower(host) + ":" + portOf(cfg.HttpsAddr, "8443")
			}
			return re.JSON(http.StatusOK, out)
		}).Bind(apis.RequireAuth(staffCollection))
		return e.Next()
	})
}

// allowedOrigins: only this app's own addresses may call the API from a browser (no other websites)
func allowedOrigins(cfg Config) []string {
	hosts := currentHosts()
	var out []string
	for _, h := range hosts {
		if strings.Contains(h, ":") {
			h = "[" + h + "]"
		}
		out = append(out, "http://"+h+":"+portOf(cfg.HttpAddr, "8090"), "https://"+h+":"+portOf(cfg.HttpsAddr, "8443"))
	}
	return out
}
