package main

// Activity log written by the server itself. Staff (even Admins) cannot add, change or delete
// entries; every create / change / delete made through the app is recorded with the signed-in
// user, plus sign-ins, failed sign-ins, exports, backups and integration changes.

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func actorName(a *core.Record) (string, string, string) {
	if a == nil {
		return "system", "", ""
	}
	if a.Collection().Name == core.CollectionNameSuperusers {
		return "superuser", "", ""
	}
	return a.GetString("username"), a.GetString("role"), a.GetString("branchId")
}

func auditLog(app core.App, actor *core.Record, action, col, id, summary string) {
	c, err := app.FindCachedCollectionByNameOrId("audit")
	if err != nil {
		return
	}
	user, role, branch := actorName(actor)
	r := core.NewRecord(c)
	r.Set("data", map[string]any{
		"at": time.Now().UTC().Format(time.RFC3339), "user": user, "role": role, "branchId": branch,
		"action": action, "col": col, "id": id, "summary": truncate(summary, 500),
	})
	if err := app.Save(r); err != nil {
		app.Logger().Error("audit log", "error", err)
	}
}

// what changed in the record's data, e.g. "status: ACTIVE -> CANCELLED; balance: 500 -> 0"
func changedKeys(before, after map[string]any) string {
	var parts []string
	keys := map[string]bool{}
	for k := range before {
		keys[k] = true
	}
	for k := range after {
		keys[k] = true
	}
	var list []string
	for k := range keys {
		if k != "updatedAt" && !sameJSON(before[k], after[k]) {
			list = append(list, k)
		}
	}
	sort.Strings(list)
	for _, k := range list {
		b, a := short(before[k]), short(after[k])
		parts = append(parts, fmt.Sprintf("%s: %s -> %s", k, b, a))
	}
	return strings.Join(parts, "; ")
}

func short(v any) string {
	switch x := v.(type) {
	case nil:
		return "-"
	case string, float64, bool:
		return truncate(fmt.Sprint(x), 40)
	case []any:
		return fmt.Sprintf("[%d]", len(x))
	default:
		return "{...}"
	}
}

func recordLabel(r *core.Record) string {
	if no := r.GetString("docNo"); no != "" {
		return no
	}
	d := appData(r)
	if n := str(d, "name", ""); n != "" {
		return n
	}
	if u := r.GetString("username"); u != "" {
		return u
	}
	return r.Id
}

func registerAudit(app core.App) {
	cols := []string{staffCollection, "appSettings"}
	for _, s := range specs {
		if s.Name != "audit" {
			cols = append(cols, s.Name)
		}
	}
	for _, name := range cols {
		col := name
		app.OnRecordCreateRequest(col).BindFunc(func(e *core.RecordRequestEvent) error {
			if err := e.Next(); err != nil {
				return err
			}
			sum := ""
			if col == "invoices" || col == "receipts" || col == "pawns" || col == "purchases" {
				d := appData(e.Record)
				sum = fmt.Sprintf("amount %v", firstNonNil(d["grandTotal"], d["amount"], d["principal"], d["total"]))
			}
			if col == staffCollection {
				sum = "role " + e.Record.GetString("role") + ", branch " + e.Record.GetString("branchId")
			}
			auditLog(e.App, e.Auth, "create", col, e.Record.Id, strings.TrimSpace(recordLabel(e.Record)+" "+sum))
			return nil
		})
		app.OnRecordUpdateRequest(col).BindFunc(func(e *core.RecordRequestEvent) error {
			orig := e.Record.Original()
			before := appData(orig)
			if err := e.Next(); err != nil {
				return err
			}
			sum := changedKeys(before, appData(e.Record))
			if col == staffCollection {
				var ch []string
				for _, f := range []string{"role", "branchId", "active", "name"} {
					if fmt.Sprint(orig.Get(f)) != fmt.Sprint(e.Record.Get(f)) {
						ch = append(ch, fmt.Sprintf("%s: %v -> %v", f, orig.Get(f), e.Record.Get(f)))
					}
				}
				if info, _ := e.RequestInfo(); info != nil {
					if p, _ := info.Body["password"].(string); p != "" {
						if e.Auth != nil && e.Auth.Id == e.Record.Id {
							ch = append(ch, "changed own password")
						} else {
							ch = append(ch, "password reset")
						}
					}
				}
				sum = strings.Join(ch, "; ")
			}
			if orig.GetString("branchId") != e.Record.GetString("branchId") {
				sum = strings.TrimSpace(sum + "; branch: " + orig.GetString("branchId") + " -> " + e.Record.GetString("branchId"))
			}
			if sum == "" {
				return nil // nothing really changed
			}
			auditLog(e.App, e.Auth, "update", col, e.Record.Id, recordLabel(e.Record)+": "+sum)
			return nil
		})
		app.OnRecordDeleteRequest(col).BindFunc(func(e *core.RecordRequestEvent) error {
			label := recordLabel(e.Record)
			if err := e.Next(); err != nil {
				return err
			}
			auditLog(e.App, e.Auth, "delete", col, e.Record.Id, label)
			return nil
		})
	}
}

func firstNonNil(vals ...any) any {
	for _, v := range vals {
		if v != nil {
			return v
		}
	}
	return "-"
}
