package main

// Default master data, loaded once on the first start (see seed/default-data.json and
// tools/make-seed.js). Collections that already contain records are never touched again.

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"path/filepath"

	"github.com/pocketbase/pocketbase/core"
)

//go:embed seed/default-data.json
var defaultDataJSON []byte

type seedFile struct {
	Settings    map[string]any              `json:"settings"`
	Collections map[string][]map[string]any `json:"collections"`
	Staff       []map[string]any            `json:"staff"`
}

func loadSeed() (*seedFile, error) {
	var s seedFile
	if err := json.Unmarshal(defaultDataJSON, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

// recordFromApp builds a PocketBase record from an app object ({id, ...fields}).
func recordFromApp(col *core.Collection, obj map[string]any) *core.Record {
	r := core.NewRecord(col)
	applyAppObject(r, obj)
	return r
}

func applyAppObject(r *core.Record, obj map[string]any) {
	data := map[string]any{}
	for k, v := range obj {
		if k != "id" {
			data[k] = v
		}
	}
	if id, ok := obj["id"].(string); ok && id != "" {
		r.Id = id
	}
	r.Set("data", data)
	s := specByName(r.Collection().Name)
	if s == nil {
		return
	}
	if s.Owned {
		b, _ := obj["branchId"].(string)
		r.Set("branchId", b)
	}
	if s.Transfer {
		f, _ := obj["fromBranchId"].(string)
		t, _ := obj["toBranchId"].(string)
		r.Set("fromBranchId", f)
		r.Set("toBranchId", t)
	}
	if s.Numbered != "" {
		n, _ := obj[s.Numbered].(string)
		r.Set("docNo", n)
	}
}

func seedIfEmpty(app core.App) error {
	seed, err := loadSeed()
	if err != nil {
		return fmt.Errorf("default data: %w", err)
	}
	return app.RunInTransaction(func(tx core.App) error {
		// settings
		if _, err := tx.FindRecordById("appSettings", "main"); err != nil {
			c, _ := tx.FindCollectionByNameOrId("appSettings")
			r := core.NewRecord(c)
			r.Id = "main"
			// default backup folder: "backups" beside the data folder chosen at install
			set := map[string]any{}
			for k, v := range seed.Settings {
				set[k] = v
			}
			set["backupDir"] = filepath.Join(filepath.Dir(tx.DataDir()), "backups")
			r.Set("data", set)
			if err := tx.Save(r); err != nil {
				return fmt.Errorf("settings: %w", err)
			}
		}
		// master data
		for name, rows := range seed.Collections {
			c, err := tx.FindCollectionByNameOrId(name)
			if err != nil {
				return err
			}
			total, err := tx.CountRecords(c)
			if err != nil {
				return err
			}
			if total > 0 {
				continue
			}
			for _, obj := range rows {
				if err := tx.Save(recordFromApp(c, obj)); err != nil {
					return fmt.Errorf("%s %v: %w", name, obj["id"], err)
				}
			}
		}
		// first administrator (must change the password at first login)
		staff, _ := tx.FindCollectionByNameOrId(staffCollection)
		total, err := tx.CountRecords(staff)
		if err != nil {
			return err
		}
		if total == 0 {
			for _, u := range seed.Staff {
				r := core.NewRecord(staff)
				r.Id, _ = u["id"].(string)
				r.Set("username", u["username"])
				r.Set("name", u["name"])
				r.Set("role", u["role"])
				r.Set("branchId", u["branchId"])
				r.Set("active", true)
				r.Set("mustChangePassword", u["mustChangePassword"])
				r.SetPassword(fmt.Sprint(u["password"]))
				if err := tx.Save(r); err != nil {
					return fmt.Errorf("staff %v: %w", u["username"], err)
				}
			}
		}
		return nil
	})
}
