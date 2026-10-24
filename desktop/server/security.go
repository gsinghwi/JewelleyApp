package main

// Sign-in protection:
//  - failed password lockout per (username, device) and per device
//  - "must change password" is enforced by the server, not only by the screens
//  - staff can never clear "must change password" without setting a new password
//  - the database superuser account only works from the server laptop itself

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const (
	lockAfterUser = 5                // wrong passwords for one username from one device
	lockAfterIP   = 20               // wrong passwords from one device, any username
	lockWindow    = 15 * time.Minute // counting window and lock time
)

type failCount struct {
	n     int
	first time.Time
	until time.Time
}

var (
	failMu sync.Mutex
	fails  = map[string]*failCount{}
)

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// locked reports how long a key is still locked
func locked(key string, now time.Time) time.Duration {
	if f := fails[key]; f != nil && now.Before(f.until) {
		return f.until.Sub(now)
	}
	return 0
}

func addFail(key string, limit int, now time.Time) {
	f := fails[key]
	if f == nil || now.Sub(f.first) > lockWindow {
		f = &failCount{first: now}
		fails[key] = f
	}
	f.n++
	if f.n >= limit {
		f.until = now.Add(lockWindow)
	}
}

func minutes(d time.Duration) int {
	m := int(d.Minutes() + 0.999)
	if m < 1 {
		m = 1
	}
	return m
}

// weak passwords refused when a password is set
var weakPasswords = map[string]bool{"admin123": true, "password": true, "12345678": true, "123456789": true, "password1": true, "qwerty123": true}

func registerSecurity(app core.App) {
	// ---- lockout ----
	app.OnRecordAuthWithPasswordRequest().BindFunc(func(e *core.RecordAuthWithPasswordRequestEvent) error {
		now := time.Now()
		ip := clientIP(e.Request)
		userKey := e.Collection.Name + "|" + strings.ToLower(strings.TrimSpace(e.Identity)) + "|" + ip
		ipKey := "ip|" + ip

		failMu.Lock()
		wait := locked(userKey, now)
		if w := locked(ipKey, now); w > wait {
			wait = w
		}
		failMu.Unlock()
		if wait > 0 {
			return e.TooManyRequestsError("Too many wrong passwords. Try again in "+itoa(minutes(wait))+" minutes, or ask the Admin.", nil)
		}

		// disabled staff cannot sign in (checked only with the right password, so it reveals nothing)
		if e.Collection.Name == staffCollection && e.Record != nil && !e.Record.GetBool("active") && e.Record.ValidatePassword(e.Password) {
			return e.ForbiddenError("This login is disabled. Ask the head office Admin.", nil)
		}

		err := e.Next()
		failMu.Lock()
		if err != nil {
			addFail(userKey, lockAfterUser, now)
			addFail(ipKey, lockAfterIP, now)
		} else {
			delete(fails, userKey)
		}
		failMu.Unlock()
		return err
	})

	app.OnRecordAuthRefreshRequest(staffCollection).BindFunc(func(e *core.RecordAuthRefreshRequestEvent) error {
		if !e.Record.GetBool("active") {
			return e.ForbiddenError("This login is disabled. Ask the head office Admin.", nil)
		}
		return e.Next()
	})

	// ---- passwords ----
	app.OnRecordCreateRequest(staffCollection).BindFunc(func(e *core.RecordRequestEvent) error {
		info, _ := e.RequestInfo()
		if p, _ := info.Body["password"].(string); weakPasswords[strings.ToLower(p)] || (p != "" && strings.EqualFold(p, e.Record.GetString("username"))) {
			return e.BadRequestError("This password is too easy to guess. Choose another one.", nil)
		}
		return e.Next()
	})

	app.OnRecordUpdateRequest(staffCollection).BindFunc(func(e *core.RecordRequestEvent) error {
		info, _ := e.RequestInfo()
		body := info.Body
		p, hasPassword := body["password"].(string)
		hasPassword = hasPassword && p != ""
		if hasPassword && (weakPasswords[strings.ToLower(p)] || strings.EqualFold(p, e.Record.GetString("username"))) {
			return e.BadRequestError("This password is too easy to guess. Choose another one.", nil)
		}
		self := e.Auth != nil && e.Auth.Id == e.Record.Id
		orig := e.Record.Original()
		if self {
			// while a new password is due, only the password can be changed
			if orig.GetBool("mustChangePassword") {
				for k := range body {
					if k != "password" && k != "passwordConfirm" && k != "oldPassword" && k != "mustChangePassword" {
						return e.ForbiddenError("Set your new password first.", nil)
					}
				}
			}
			if v, ok := body["mustChangePassword"]; ok && v == false && orig.GetBool("mustChangePassword") && !hasPassword {
				return e.ForbiddenError("Set your new password first.", nil)
			}
			if hasPassword {
				e.Record.Set("mustChangePassword", false)
			} else {
				e.Record.Set("mustChangePassword", orig.GetBool("mustChangePassword")) // cannot be cleared without a new password
			}
		} else if hasPassword {
			e.Record.Set("mustChangePassword", true) // password reset by the Admin: the user picks their own at next sign in
		}
		return e.Next()
	})
}

// requestAllowedBeforePasswordChange lists what a user who must change their password may call
func requestAllowedBeforePasswordChange(re *core.RequestEvent) bool {
	p, m := re.Request.URL.Path, re.Request.Method
	switch {
	case p == "/api/jw/health", p == "/api/health":
		return true
	case strings.HasPrefix(p, "/api/collections/"+staffCollection+"/auth-"):
		return true
	case m == http.MethodPatch && p == "/api/collections/"+staffCollection+"/records/"+re.Auth.Id:
		return true
	case m == http.MethodGet && strings.HasPrefix(p, "/api/collections/appSettings/records"):
		return true
	case !strings.HasPrefix(p, "/api/"):
		return true // the web pages themselves
	}
	return false
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	s := ""
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	return s
}
