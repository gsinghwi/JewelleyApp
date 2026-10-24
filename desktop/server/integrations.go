package main

// WhatsApp Business Cloud API and Razorpay, done on the server so that the access token and
// the Razorpay Key Secret never reach the browser. The keys are entered by the head office
// Admin in the app (Settings > Integrations) and stored in the superuser-only `secrets`
// collection.
//
// Razorpay flow (Standard Checkout with Orders):
//   1. app -> POST /api/jw/razorpay/order {amount}       server creates the order with the secret
//   2. app opens Razorpay Checkout with the order id and the public Key ID
//   3. app -> POST /api/jw/razorpay/verify {order, payment, signature}
//      server checks the HMAC signature, fetches the payment and captures it if only authorized.

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
)

var httpClient = &http.Client{Timeout: 25 * time.Second}

const razorpayAPI = "https://api.razorpay.com/v1"

func getSecret(app core.App, id string) map[string]any {
	r, err := app.FindRecordById("secrets", id)
	if err != nil {
		return map[string]any{}
	}
	return openSecret(app, appData(r))
}

func saveSecret(app core.App, id string, data map[string]any) error {
	col, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		return err
	}
	r, err := app.FindRecordById(col, id)
	if err != nil {
		r = core.NewRecord(col)
		r.Id = id
	}
	sealed, err := sealSecret(app, data)
	if err != nil {
		return err
	}
	r.Set("data", sealed)
	return app.Save(r)
}

func mask(s string) string {
	if len(s) <= 6 {
		return strings.Repeat("•", len(s))
	}
	return s[:4] + strings.Repeat("•", 6) + s[len(s)-2:]
}

func callJSON(method, url string, body any, auth func(*http.Request)) (map[string]any, int, error) {
	var rdr io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rdr = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, url, rdr)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	if auth != nil {
		auth(req)
	}
	res, err := httpClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	out := map[string]any{}
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	_ = json.Unmarshal(raw, &out)
	return out, res.StatusCode, nil
}

// error text from a Razorpay / Graph API error body
func apiErrorText(m map[string]any, status int) string {
	if e, ok := m["error"].(map[string]any); ok {
		for _, k := range []string{"error_user_msg", "description", "message"} {
			if s, ok := e[k].(string); ok && s != "" {
				return s
			}
		}
	}
	return fmt.Sprintf("HTTP %d", status)
}

func registerIntegrations(app core.App) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		g := e.Router.Group("/api/jw")
		g.Bind(apis.RequireAuth(staffCollection))

		// ---- settings (head office Admin) ----
		g.GET("/integrations", func(re *core.RequestEvent) error {
			if !isMasterUser(re, "Admin") {
				return re.ForbiddenError("Only the head office Admin can see integration settings.", nil)
			}
			wa := getSecret(re.App, "whatsapp")
			rp := getSecret(re.App, "razorpay")
			key := str(rp, "keyId", "")
			return re.JSON(http.StatusOK, map[string]any{
				"whatsapp": map[string]any{"phoneNumberId": str(wa, "phoneNumberId", ""), "apiVersion": str(wa, "apiVersion", "v21.0"),
					"tokenSet": str(wa, "token", "") != "", "tokenHint": mask(str(wa, "token", ""))},
				"razorpay": map[string]any{"keyId": key, "secretSet": str(rp, "keySecret", "") != "", "secretHint": mask(str(rp, "keySecret", "")),
					"mode": map[bool]string{true: "test", false: "live"}[strings.HasPrefix(key, "rzp_test_")]},
			})
		})

		g.POST("/integrations", func(re *core.RequestEvent) error {
			if !isMasterUser(re, "Admin") {
				return re.ForbiddenError("Only the head office Admin can change integration settings.", nil)
			}
			var body struct {
				WhatsApp *struct {
					PhoneNumberId string `json:"phoneNumberId"`
					ApiVersion    string `json:"apiVersion"`
					Token         string `json:"token"`
					ClearToken    bool   `json:"clearToken"`
				} `json:"whatsapp"`
				Razorpay *struct {
					KeyId       string `json:"keyId"`
					KeySecret   string `json:"keySecret"`
					ClearSecret bool   `json:"clearSecret"`
				} `json:"razorpay"`
			}
			if err := re.BindBody(&body); err != nil {
				return re.BadRequestError("Invalid data", err)
			}
			if w := body.WhatsApp; w != nil {
				cur := getSecret(re.App, "whatsapp")
				cur["phoneNumberId"] = strings.TrimSpace(w.PhoneNumberId)
				cur["apiVersion"] = strings.TrimSpace(w.ApiVersion)
				if w.ClearToken {
					cur["token"] = ""
				} else if t := strings.TrimSpace(w.Token); t != "" {
					cur["token"] = t
				}
				auditLog(re.App, re.Auth, "update", "integrations", "whatsapp", "WhatsApp settings changed")
				if err := saveSecret(re.App, "whatsapp", cur); err != nil {
					return err
				}
			}
			if p := body.Razorpay; p != nil {
				key := strings.TrimSpace(p.KeyId)
				if key != "" && !strings.HasPrefix(key, "rzp_test_") && !strings.HasPrefix(key, "rzp_live_") {
					return re.BadRequestError("The Razorpay Key ID starts with rzp_test_ or rzp_live_.", nil)
				}
				cur := getSecret(re.App, "razorpay")
				cur["keyId"] = key
				if p.ClearSecret {
					cur["keySecret"] = ""
				} else if s := strings.TrimSpace(p.KeySecret); s != "" {
					cur["keySecret"] = s
				}
				auditLog(re.App, re.Auth, "update", "integrations", "razorpay", "Razorpay keys changed")
				if err := saveSecret(re.App, "razorpay", cur); err != nil {
					return err
				}
			}
			return re.JSON(http.StatusOK, map[string]any{"ok": true})
		})

		// ---- WhatsApp Cloud API ----
		g.POST("/whatsapp/send", func(re *core.RequestEvent) error {
			if !isMasterUser(re, "Admin") {
				return re.ForbiddenError("Only the head office Admin can send WhatsApp messages.", nil)
			}
			var body struct {
				To       string   `json:"to"`
				Template string   `json:"template"`
				Language string   `json:"language"`
				Params   []string `json:"params"`
			}
			if err := re.BindBody(&body); err != nil || body.To == "" || body.Template == "" {
				return re.BadRequestError("Recipient and template are required.", nil)
			}
			wa := getSecret(re.App, "whatsapp")
			token, phoneId := str(wa, "token", ""), str(wa, "phoneNumberId", "")
			if token == "" || phoneId == "" {
				return re.BadRequestError("WhatsApp is not configured. Enter the Phone number ID and access token in Settings > Integrations.", nil)
			}
			params := []map[string]any{}
			for _, p := range body.Params {
				params = append(params, map[string]any{"type": "text", "text": p})
			}
			tpl := map[string]any{"name": body.Template, "language": map[string]any{"code": firstNonEmpty(body.Language, "en")}}
			if len(params) > 0 {
				tpl["components"] = []any{map[string]any{"type": "body", "parameters": params}}
			}
			out, status, err := callJSON(http.MethodPost, fmt.Sprintf("https://graph.facebook.com/%s/%s/messages", str(wa, "apiVersion", "v21.0"), phoneId),
				map[string]any{"messaging_product": "whatsapp", "to": body.To, "type": "template", "template": tpl},
				func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+token) })
			if err != nil {
				return re.BadRequestError("Could not reach WhatsApp: "+err.Error(), nil)
			}
			if status >= 300 {
				return re.BadRequestError(apiErrorText(out, status), nil)
			}
			id := ""
			if msgs, ok := out["messages"].([]any); ok && len(msgs) > 0 {
				if m, ok := msgs[0].(map[string]any); ok {
					id, _ = m["id"].(string)
				}
			}
			return re.JSON(http.StatusOK, map[string]any{"id": id})
		})

		// ---- Razorpay ----
		g.GET("/razorpay/config", func(re *core.RequestEvent) error {
			rp := getSecret(re.App, "razorpay")
			key := str(rp, "keyId", "")
			return re.JSON(http.StatusOK, map[string]any{"enabled": key != "" && str(rp, "keySecret", "") != "", "keyId": key,
				"mode": map[bool]string{true: "test", false: "live"}[strings.HasPrefix(key, "rzp_test_")]})
		})

		g.POST("/razorpay/order", func(re *core.RequestEvent) error {
			var body struct {
				Amount  float64           `json:"amount"`
				Receipt string            `json:"receipt"`
				Notes   map[string]string `json:"notes"`
			}
			if err := re.BindBody(&body); err != nil || body.Amount < 1 {
				return re.BadRequestError("Amount must be at least 1 rupee.", nil)
			}
			rp := getSecret(re.App, "razorpay")
			key, secret := str(rp, "keyId", ""), str(rp, "keySecret", "")
			if key == "" || secret == "" {
				return re.BadRequestError("Razorpay is not configured. Enter the Key ID and Key Secret in Settings > Integrations.", nil)
			}
			if body.Notes == nil {
				body.Notes = map[string]string{}
			}
			body.Notes["branch"] = re.Auth.GetString("branchId")
			body.Notes["user"] = re.Auth.GetString("username")
			out, status, err := callJSON(http.MethodPost, razorpayAPI+"/orders", map[string]any{
				"amount": int64(math.Round(body.Amount * 100)), "currency": "INR", "receipt": truncate(body.Receipt, 40), "notes": body.Notes,
			}, func(r *http.Request) { r.SetBasicAuth(key, secret) })
			if err != nil {
				return re.BadRequestError("Could not reach Razorpay: "+err.Error(), nil)
			}
			if status >= 300 {
				return re.BadRequestError("Razorpay: "+apiErrorText(out, status), nil)
			}
			return re.JSON(http.StatusOK, map[string]any{"orderId": out["id"], "keyId": key, "amount": out["amount"], "currency": out["currency"]})
		})

		g.POST("/razorpay/verify", func(re *core.RequestEvent) error {
			var body struct {
				OrderId      string `json:"orderId"`
				PaymentId    string `json:"paymentId"`
				Signature    string `json:"signature"`
				BranchId     string `json:"branchId"`
				Purpose      string `json:"purpose"`
				Description  string `json:"description"`
				CustomerId   string `json:"customerId"`
				CustomerName string `json:"customerName"`
				Contact      string `json:"contact"`
			}
			if err := re.BindBody(&body); err != nil || body.OrderId == "" || body.PaymentId == "" || body.Signature == "" {
				return re.BadRequestError("Order, payment and signature are required.", nil)
			}
			rp := getSecret(re.App, "razorpay")
			key, secret := str(rp, "keyId", ""), str(rp, "keySecret", "")
			mac := hmac.New(sha256.New, []byte(secret))
			mac.Write([]byte(body.OrderId + "|" + body.PaymentId))
			if secret == "" || !hmac.Equal([]byte(hex.EncodeToString(mac.Sum(nil))), []byte(body.Signature)) {
				return re.BadRequestError("Payment signature does not match. Do not treat this payment as received.", nil)
			}
			auth := func(r *http.Request) { r.SetBasicAuth(key, secret) }
			result := map[string]any{"verified": true, "status": "authorized", "method": "", "methodDetail": ""}
			pay, status, err := callJSON(http.MethodGet, razorpayAPI+"/payments/"+body.PaymentId, nil, auth)
			if err == nil && status < 300 {
				st, _ := pay["status"].(string)
				if st == "authorized" { // capture so that Razorpay does not auto-refund it
					cap, cs, cerr := callJSON(http.MethodPost, razorpayAPI+"/payments/"+body.PaymentId+"/capture",
						map[string]any{"amount": pay["amount"], "currency": firstNonEmpty(fmt.Sprint(pay["currency"]), "INR")}, auth)
					if cerr == nil && cs < 300 {
						pay = cap
						st, _ = cap["status"].(string)
					}
				}
				result["status"] = st
				result["method"] = pay["method"]
				result["methodDetail"] = paymentDetail(pay)
				result["amount"] = pay["amount"]
			}
			// The server records the payment (the app cannot create a "paid" record itself)
			rec, err := recordGatewayPayment(re, key, body.PaymentId, body.OrderId, result, map[string]any{
				"purpose": truncate(body.Purpose, 60), "description": truncate(body.Description, 200), "customerId": body.CustomerId,
				"customerName": truncate(body.CustomerName, 150), "contact": truncate(body.Contact, 20),
			}, body.BranchId)
			if err != nil {
				re.App.Logger().Error("razorpay: could not record payment", "payment", body.PaymentId, "error", err)
				return re.InternalServerError("The payment was received but could not be recorded. Note payment ID "+body.PaymentId+".", nil)
			}
			result["record"] = rec
			return re.JSON(http.StatusOK, result)
		})
		return e.Next()
	})
}

func paymentDetail(p map[string]any) string {
	switch p["method"] {
	case "upi":
		if v, ok := p["vpa"].(string); ok && v != "" {
			return "UPI " + v
		}
		return "UPI"
	case "card":
		if c, ok := p["card"].(map[string]any); ok {
			return fmt.Sprintf("%v card ending %v", c["network"], c["last4"])
		}
	case "netbanking":
		return fmt.Sprint("Net banking ", p["bank"])
	case "wallet":
		return fmt.Sprint(p["wallet"], " wallet")
	}
	return fmt.Sprint(p["method"])
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" && v != "<nil>" {
			return v
		}
	}
	return ""
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// recordGatewayPayment saves a confirmed Razorpay payment once (repeated calls return the same record)
func recordGatewayPayment(re *core.RequestEvent, keyId, paymentId, orderId string, result map[string]any, info map[string]any, branchId string) (*core.Record, error) {
	gatewayRecordMu.Lock()
	defer gatewayRecordMu.Unlock()
	if r, err := re.App.FindFirstRecordByFilter("gatewayPayments", "data.paymentId = {:p}", dbx.Params{"p": paymentId}); err == nil {
		return r, nil
	}
	col, err := re.App.FindCollectionByNameOrId("gatewayPayments")
	if err != nil {
		return nil, err
	}
	// head office Admin / Manager may collect for the branch they are working in
	branch := re.Auth.GetString("branchId")
	if branchId != "" && branchId != branch && re.Auth.GetBool("isMaster") {
		if r := re.Auth.GetString("role"); r == "Admin" || r == "Manager" {
			if _, err := re.App.FindRecordById("branches", branchId); err == nil {
				branch = branchId
			}
		}
	}
	paise, _ := result["amount"].(float64)
	env := "live"
	if strings.HasPrefix(keyId, "rzp_test_") {
		env = "test"
	}
	now := time.Now().UTC().Format(time.RFC3339)
	d := map[string]any{
		"gateway": "RAZORPAY", "env": env, "currency": "INR", "status": result["status"], "amount": paise / 100,
		"method": result["method"], "methodDetail": result["methodDetail"], "paymentId": paymentId, "orderId": orderId,
		"by": re.Auth.GetString("username"), "createdAt": now, "at": now,
	}
	for k, v := range info {
		d[k] = v
	}
	r := core.NewRecord(col)
	r.Id = "gwp_" + security.RandomStringWithAlphabet(14, "abcdefghijklmnopqrstuvwxyz0123456789")
	r.Set("branchId", branch)
	r.Set("data", d)
	return r, re.App.Save(r)
}

var gatewayRecordMu sync.Mutex
