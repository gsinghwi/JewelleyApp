package main

// Further protection:
//  - records still used elsewhere cannot be deleted (checked by the server, across all branches)
//  - the login page gets only the branding it shows; other shop settings need a sign in
//  - request rate limits per device
//  - security headers on every page: Content-Security-Policy, Referrer-Policy, Permissions-Policy

import (
	"net/http"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

type usedBy struct {
	col, filter, what string
}

// what refers to a record, by collection
var deleteGuards = map[string][]usedBy{
	"customers": {
		{"invoices", "data.customerId = {:id}", "bills"},
		{"receipts", "data.customerId = {:id}", "receipts"},
		{"pawns", "data.customerId = {:id}", "pawn loans"},
	},
	"items":          {{"stock", "data.itemId = {:id}", "stock pieces"}},
	"categories":     {{"items", "data.categoryId = {:id}", "items"}},
	"metals":         {{"purities", "data.metalId = {:id}", "purities"}, {"items", "data.metalId = {:id}", "items"}},
	"purities":       {{"stock", "data.purityId = {:id}", "stock pieces"}, {"items", "data.purityId = {:id}", "items"}},
	"hsn":            {{"items", "data.hsn = {:id}", "items"}},
	"customerGroups": {{"customers", "data.groupId = {:id}", "customers"}},
	"vendors": {
		{"purchases", "data.vendorId = {:id}", "purchases"},
		{"vendorPayments", "data.vendorId = {:id}", "vendor payments"},
		{"stock", "data.vendorId = {:id}", "stock pieces"},
	},
	"branches": {
		{staffCollection, "branchId = {:id}", "users"},
		{"stock", "branchId = {:id}", "stock pieces"},
		{"invoices", "branchId = {:id}", "bills"},
		{"customers", "branchId = {:id}", "customers"},
		{"pawns", "branchId = {:id}", "pawn loans"},
	},
}

func registerHardening(app core.App) {
	for col, guards := range deleteGuards {
		col, guards := col, guards
		app.OnRecordDeleteRequest(col).BindFunc(func(e *core.RecordRequestEvent) error {
			if col == "customers" && e.Record.Id == "cus_walkin" {
				return e.BadRequestError("The walk-in customer is needed for cash bills and cannot be deleted.", nil)
			}
			if col == "branches" && str(appData(e.Record), "type", "") == "MASTER" {
				return e.BadRequestError("The head office (master) branch cannot be deleted.", nil)
			}
			for _, g := range guards {
				if r, err := e.App.FindFirstRecordByFilter(g.col, g.filter, dbx.Params{"id": e.Record.Id}); err == nil && r != nil {
					return e.BadRequestError("Cannot delete: it is still used by "+g.what+". Make it inactive instead.", nil)
				}
			}
			return e.Next()
		})
	}

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		// what the sign-in page shows, nothing else (GSTIN, PAN, backup folder... need a sign in)
		e.Router.GET("/api/jw/branding", func(re *core.RequestEvent) error {
			s := settingsData(re.App)
			out := map[string]any{}
			for _, k := range []string{"shopName", "tagline", "loginWelcome", "logo", "loginBg", "primaryColor", "accentColor", "address", "phone"} {
				if v, ok := s[k]; ok {
					out[k] = v
				}
			}
			return re.JSON(http.StatusOK, out)
		})

		// security headers on every response except the PocketBase admin pages (/_/)
		e.Router.BindFunc(func(re *core.RequestEvent) error {
			if !strings.HasPrefix(re.Request.URL.Path, "/_/") {
				h := re.Response.Header()
				h.Set("Content-Security-Policy", contentSecurityPolicy)
				h.Set("Referrer-Policy", "same-origin")
				h.Set("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=(self \"https://api.razorpay.com\")")
				h.Set("X-Frame-Options", "SAMEORIGIN")
			}
			return re.Next()
		})
		return e.Next()
	})
}

// Scripts only from this app and Razorpay's checkout; no inline scripts; the page can only talk to
// this server and Razorpay (live rates are fetched through the server).
const contentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self' https://checkout.razorpay.com; " +
	"connect-src 'self' https://*.razorpay.com; " +
	"frame-src https://api.razorpay.com https://checkout.razorpay.com; " +
	"img-src 'self' data: blob: https:; " +
	"style-src 'self' 'unsafe-inline'; " +
	"font-src 'self' data:; " +
	"media-src 'self' blob: mediastream:; " +
	"worker-src 'self' blob:; " +
	"object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"

// rate limits per device (requests per interval); generous for a busy counter, tight for abuse
func applyRateLimits(app core.App) error {
	s := app.Settings()
	s.RateLimits.Enabled = true
	s.RateLimits.Rules = []core.RateLimitRule{
		{Label: "*:auth", MaxRequests: 30, Duration: 60},
		{Label: "*:create", MaxRequests: 300, Duration: 10},
		{Label: "/api/", MaxRequests: 1500, Duration: 10},
	}
	return app.Save(s)
}
