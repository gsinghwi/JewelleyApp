package main

// Live rates: the browser asks the server to fetch the rate feeds (only from known rate sources,
// over https, never from the shop's own network), and the server refuses rates that cannot be
// right: outside a sane range for the metal, or a jump of more than 25% from the last saved rate
// unless the user confirmed it.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// rupees per gram that can be real (same ranges the app uses to detect units)
var rateRange = map[string][2]float64{"GOLD": {2000, 80000}, "SILVER": {20, 2000}, "PLATINUM": {1000, 40000}}

var rateHosts = []string{"ibja-api.vercel.app", "api.gold-api.com", "cdn.jsdelivr.net", "latest.currency-api.pages.dev"}

func allowedRateHost(app core.App, host string) bool {
	host = strings.ToLower(host)
	allowed := append([]string{}, rateHosts...)
	set := settingsData(app)
	for _, k := range []string{"ibjaUrl", "rateApiUrl"} {
		if u, err := url.Parse(str(set, k, "")); err == nil && u.Host != "" {
			allowed = append(allowed, strings.ToLower(u.Hostname()))
		}
	}
	for _, a := range allowed {
		if host == a {
			return true
		}
	}
	return false
}

var rateClient = &http.Client{Timeout: 12 * time.Second}

// publicHost refuses feed addresses that point into the shop network or this laptop
func publicHost(ctx context.Context, host string) error {
	if h := strings.ToLower(host); h == "localhost" || strings.HasSuffix(h, ".local") {
		return fmt.Errorf("%s is not a public internet address", host)
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		// networks that reach the internet only through a proxy cannot resolve names locally;
		// the proxy then resolves them (and cannot reach this laptop's private addresses anyway)
		if req, _ := http.NewRequest(http.MethodGet, "https://"+host+"/", nil); req != nil {
			if p, _ := http.ProxyFromEnvironment(req); p != nil {
				return nil
			}
		}
		return err
	}
	for _, ip := range ips {
		if ip.IP.IsLoopback() || ip.IP.IsPrivate() || ip.IP.IsLinkLocalUnicast() || ip.IP.IsUnspecified() {
			return fmt.Errorf("%s is not a public internet address", host)
		}
	}
	return nil
}

func registerRates(app core.App) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.GET("/api/jw/rates/fetch", func(re *core.RequestEvent) error {
			if !isMasterUser(re, "Admin", "Manager") {
				return re.ForbiddenError("Only head office Admin / Manager can fetch live rates.", nil)
			}
			u, err := url.Parse(re.Request.URL.Query().Get("url"))
			if err != nil || u.Scheme != "https" || u.Host == "" {
				return re.BadRequestError("The rate feed must be an https:// address.", nil)
			}
			if !allowedRateHost(re.App, u.Hostname()) {
				return re.BadRequestError("This rate source is not allowed. Set it in Live rate settings first.", nil)
			}
			if err := publicHost(re.Request.Context(), u.Hostname()); err != nil {
				return re.BadRequestError("This rate source cannot be used: "+err.Error(), nil)
			}
			res, err := rateClient.Get(u.String())
			if err != nil {
				return re.BadRequestError("Could not reach "+u.Hostname()+": "+err.Error(), nil)
			}
			defer res.Body.Close()
			if res.StatusCode >= 300 {
				return re.BadRequestError(fmt.Sprintf("HTTP %d from %s", res.StatusCode, u.Hostname()), nil)
			}
			raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
			if err != nil {
				return re.BadRequestError("Could not read the reply from "+u.Hostname(), nil)
			}
			var v any
			if err := json.Unmarshal(raw, &v); err != nil {
				return re.BadRequestError(u.Hostname()+" did not return rate data (JSON).", nil)
			}
			return re.JSON(http.StatusOK, v)
		}).Bind(apis.RequireAuth(staffCollection))
		return e.Next()
	})

	app.OnRecordCreateRequest("rates").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() {
			return e.Next()
		}
		d := appData(e.Record)
		values, _ := d["values"].(map[string]any)
		if len(values) == 0 {
			return e.BadRequestError("No rates to save.", nil)
		}
		prev := map[string]any{}
		if last, err := e.App.FindRecordsByFilter("rates", "", "-created", 1, 0); err == nil && len(last) == 1 {
			prev, _ = appData(last[0])["values"].(map[string]any)
		}
		confirmed, _ := d["confirmedLargeChange"].(bool)
		for id, v := range values {
			n, ok := v.(float64)
			if !ok || n <= 0 {
				return e.BadRequestError("Rate for "+id+" must be a positive number.", nil)
			}
			p, err := e.App.FindRecordById("purities", id)
			if err != nil {
				return e.BadRequestError("Unknown purity "+id+".", nil)
			}
			metal := str(appData(p), "metalId", "")
			if r, ok := rateRange[metal]; ok {
				fine := numOf(appData(p), "fineness")
				lo := r[0] * math.Max(fine, 300) / 1000 // lower purities have lower rates
				if n < lo || n > r[1] {
					return e.BadRequestError(fmt.Sprintf("%s: %.2f per gram is not a realistic %s rate. Check the number.", str(appData(p), "name", id), n, strings.ToLower(metal)), nil)
				}
			}
			if old, ok := prev[id].(float64); ok && old > 0 && math.Abs(n-old)/old > 0.25 && !confirmed {
				return e.BadRequestError(fmt.Sprintf("%s changes by more than 25%% (%.0f to %.0f). Check it and confirm.", str(appData(p), "name", id), old, n), nil)
			}
		}
		delete(d, "confirmedLargeChange")
		d["by"] = e.Auth.GetString("username")
		e.Record.Set("data", d)
		return e.Next()
	})
}
