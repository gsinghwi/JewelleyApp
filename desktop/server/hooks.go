package main

// Server-side rules that must not depend on the app behaving:
//  - staff: isMaster is derived from the branch, Admins must belong to the master branch,
//    and users can only change their own password (not their role, branch or status).
//  - document numbers (invoice, receipt, pawn, purchase, transfer, tag, customer code) are
//    assigned here, one series per branch, so two counters never issue the same number.

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	validation "github.com/go-ozzo/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/core"
)

var numberingMu sync.Mutex

func registerHooks(app core.App) {
	// ---- staff ----
	staffCheck := func(e *core.RecordEvent) error {
		r := e.Record
		br, err := e.App.FindRecordById("branches", r.GetString("branchId"))
		if err != nil {
			return validation.Errors{"branchId": validation.NewError("invalid_branch", "This branch does not exist.")}
		}
		isMaster := appData(br)["type"] == "MASTER"
		if r.GetString("role") == "Admin" && !isMaster {
			return validation.Errors{"role": validation.NewError("admin_master_only", "Admin users must belong to the master branch. Use Manager or Sales for branch users.")}
		}
		r.Set("isMaster", isMaster)
		return e.Next()
	}
	app.OnRecordCreate(staffCollection).BindFunc(staffCheck)
	app.OnRecordUpdate(staffCollection).BindFunc(staffCheck)

	// Same checks at request level so the app shows the reason instead of a generic error
	requestCheck := func(e *core.RecordRequestEvent) error {
		r := e.Record
		br, err := e.App.FindRecordById("branches", r.GetString("branchId"))
		if err != nil {
			return e.BadRequestError("This branch does not exist.", nil)
		}
		if r.GetString("role") == "Admin" && appData(br)["type"] != "MASTER" {
			return e.BadRequestError("Admin users must belong to the master branch. Use Manager or Sales for branch users.", nil)
		}
		return e.Next()
	}
	app.OnRecordCreateRequest(staffCollection).BindFunc(requestCheck)
	app.OnRecordUpdateRequest(staffCollection).BindFunc(requestCheck)

	app.OnRecordUpdateRequest(staffCollection).BindFunc(func(e *core.RecordRequestEvent) error {
		info, _ := e.RequestInfo()
		admin := e.Auth != nil && e.Auth.GetBool("isMaster") && e.Auth.GetString("role") == "Admin"
		if !admin {
			orig := e.Record.Original()
			for _, f := range []string{"username", "role", "branchId", "active", "isMaster"} {
				if fmt.Sprint(orig.Get(f)) != fmt.Sprint(e.Record.Get(f)) {
					return e.ForbiddenError("You can only change your own password.", nil)
				}
			}
		}
		if info != nil && info.Body["password"] != nil && e.Auth != nil && e.Auth.Id == e.Record.Id {
			e.Record.Set("mustChangePassword", false) // the user has set their own password
		}
		return e.Next()
	})

	app.OnRecordDeleteRequest(staffCollection).BindFunc(func(e *core.RecordRequestEvent) error {
		if e.Auth != nil && e.Auth.Id == e.Record.Id {
			return e.BadRequestError("You cannot delete your own login.", nil)
		}
		return e.Next()
	})

	// ---- document numbers ----
	for _, s := range specs {
		if s.Numbered == "" {
			continue
		}
		spec := s
		app.OnRecordCreate(spec.Name).BindFunc(func(e *core.RecordEvent) error {
			numberingMu.Lock()
			defer numberingMu.Unlock()
			if err := assignNumber(e.App, spec, e.Record); err != nil {
				return err
			}
			return e.Next()
		})
		// keep docNo in step with the number inside the record; a number cannot be blanked
		app.OnRecordUpdate(spec.Name).BindFunc(func(e *core.RecordEvent) error {
			data := appData(e.Record)
			no := str(data, spec.Numbered, "")
			if no == "" && e.Record.GetString("docNo") != "" {
				data[spec.Numbered] = e.Record.GetString("docNo")
				e.Record.Set("data", data)
			} else if no != "" {
				e.Record.Set("docNo", no)
			}
			return e.Next()
		})
	}
}

func appData(r *core.Record) map[string]any {
	out := map[string]any{}
	raw, err := json.Marshal(r.Get("data"))
	if err == nil {
		_ = json.Unmarshal(raw, &out)
	}
	return out
}

func settingsData(app core.App) map[string]any {
	r, err := app.FindRecordById("appSettings", "main")
	if err != nil {
		return map[string]any{}
	}
	return appData(r)
}

func str(m map[string]any, k, def string) string {
	if v, ok := m[k].(string); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return def
}

// Indian financial year label (April-March), e.g. 2026-27
func finYear(date string) string {
	var y, mth int
	if _, err := fmt.Sscanf(date, "%4d-%2d", &y, &mth); err != nil || y < 2000 {
		return "0000-00"
	}
	if mth < 4 {
		y--
	}
	return fmt.Sprintf("%d-%02d", y, (y+1)%100)
}

func nextCounter(app core.App, key string, start int) (int, error) {
	id := strings.NewReplacer(":", "-", "/", "-").Replace(key)
	col, err := app.FindCollectionByNameOrId("counters")
	if err != nil {
		return 0, err
	}
	r, err := app.FindRecordById(col, id)
	if err != nil {
		r = core.NewRecord(col)
		r.Id = id
		r.Set("value", start)
	}
	n := r.GetInt("value") + 1
	r.Set("value", n)
	if err := app.Save(r); err != nil {
		return 0, err
	}
	return n, nil
}

func branchCode(app core.App, id string) string {
	if id == "" {
		return ""
	}
	if br, err := app.FindRecordById("branches", id); err == nil {
		return str(appData(br), "code", "")
	}
	return ""
}

func docExists(app core.App, collection, no string) bool {
	r, _ := app.FindFirstRecordByData(collection, "docNo", no)
	return r != nil
}

func assignNumber(app core.App, s Spec, r *core.Record) error {
	data := appData(r)
	current := str(data, s.Numbered, "")
	if current != "" { // a number typed by the user (e.g. own tag no.) is kept; the unique index rejects duplicates
		r.Set("docNo", current)
		return nil
	}
	set := settingsData(app)
	date := str(data, "date", str(data, "billDate", ""))
	if date == "" {
		date = r.GetDateTime("created").Time().Format("2006-01-02")
		if r.GetDateTime("created").IsZero() {
			date = nowDate()
		}
	}
	branch := r.GetString("branchId")
	if s.Transfer {
		branch = r.GetString("fromBranchId")
	}
	// serials run per branch and restart every financial year (April-March)
	series := func(prefix, counter string) (string, error) {
		p := prefix
		if code := branchCode(app, branch); code != "" {
			p += "/" + code
		}
		fy := finYear(date)
		for {
			n, err := nextCounter(app, counter+":"+branch+":"+fy, 0)
			if err != nil {
				return "", err
			}
			no := fmt.Sprintf("%s/%s/%04d", p, fy, n)
			if !docExists(app, s.Name, no) { // e.g. a prefix changed back to an older one
				return no, nil
			}
		}
	}
	var no string
	var err error
	switch s.Name {
	case "invoices":
		no, err = series(str(set, "invoicePrefix", "INV"), "invoice")
	case "receipts":
		no, err = series("RCT", "receipt")
	case "pawns":
		no, err = series(str(set, "pawnPrefix", "PWN"), "pawn")
	case "purchases":
		no, err = series(str(set, "purchasePrefix", "PUR"), "purchase")
	case "transfers":
		no, err = series("TRF", "transfer")
	case "stock":
		prefix := str(set, "tagPrefix", "T")
		for {
			n, e := nextCounter(app, "tag", 1000)
			if e != nil {
				return e
			}
			no = fmt.Sprintf("%s%d", prefix, n)
			if !docExists(app, "stock", no) {
				break
			}
		}
	case "customers":
		for {
			n, e := nextCounter(app, "customer", 0)
			if e != nil {
				return e
			}
			no = fmt.Sprintf("C%04d", n)
			if !docExists(app, "customers", no) {
				break
			}
		}
	}
	if err != nil {
		return err
	}
	data[s.Numbered] = no
	r.Set("data", data)
	r.Set("docNo", no)
	return nil
}
