package main

// Export to MySQL 8 / MariaDB 10.5+.
//
// Produces one .sql file that recreates every table and inserts every record:
//   - one table per collection, named jw_<collection>, e.g. jw_invoices
//   - id, branch_id, doc_no and the key business columns (see schema.go) as real columns
//   - the complete app record in a JSON column `data` (nothing is lost)
//   - jw_users with bcrypt password hashes, jw_settings and jw_counters
// WhatsApp / Razorpay secret keys are deliberately not exported.
//
//   jewellery-server export-mysql --out jewellery.sql
//   mysql -u root -p jewelleryapp < jewellery.sql

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/spf13/cobra"
)

var sqlEscaper = strings.NewReplacer(`\`, `\\`, `'`, `\'`, "\x00", `\0`, "\n", `\n`, "\r", `\r`, "\x1a", `\Z`)

func sqlString(s string) string { return "'" + sqlEscaper.Replace(s) + "'" }

var (
	reDate    = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}`)
	reVarchar = regexp.MustCompile(`^VARCHAR\((\d+)\)$`)
)

func sqlValue(v any, typ string) string {
	if v == nil {
		return "NULL"
	}
	switch {
	case typ == "BOOLEAN":
		if b, ok := v.(bool); ok {
			if b {
				return "1"
			}
			return "0"
		}
		return "NULL"
	case typ == "DATE":
		s, _ := v.(string)
		if reDate.MatchString(s) {
			return sqlString(s[:10])
		}
		return "NULL"
	case typ == "INT" || strings.HasPrefix(typ, "DECIMAL"):
		switch n := v.(type) {
		case float64:
			if typ == "INT" {
				return strconv.FormatInt(int64(n), 10)
			}
			return strconv.FormatFloat(n, 'f', -1, 64)
		case string:
			if f, err := strconv.ParseFloat(strings.TrimSpace(n), 64); err == nil {
				return strconv.FormatFloat(f, 'f', -1, 64)
			}
		}
		return "NULL"
	default:
		s := fmt.Sprint(v)
		if m := reVarchar.FindStringSubmatch(typ); m != nil {
			n, _ := strconv.Atoi(m[1])
			if r := []rune(s); len(r) > n {
				s = string(r[:n]) // full value stays in the JSON column
			}
		}
		return sqlString(s)
	}
}

func sqlDateTime(r *core.Record, field string) string {
	t := r.GetDateTime(field)
	if t.IsZero() {
		return "NULL"
	}
	return sqlString(t.Time().UTC().Format("2006-01-02 15:04:05"))
}

func writeMySQL(app core.App, w io.Writer) error {
	bw := bufio.NewWriter(w)
	p := func(format string, a ...any) { fmt.Fprintf(bw, format, a...) }
	p("-- JewelleryApp data export for MySQL 8 / MariaDB 10.5+\n")
	p("-- Created %s from %s\n", time.Now().Format(time.RFC1123), app.DataDir())
	p("-- Import: mysql -u USER -p DATABASE < this-file.sql\n\n")
	p("SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\nSET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';\n\n")

	for _, s := range specs {
		table := "jw_" + s.Name
		p("-- %s\nDROP TABLE IF EXISTS `%s`;\nCREATE TABLE `%s` (\n  `id` VARCHAR(64) NOT NULL,\n", s.Title, table, table)
		cols := []string{"id"}
		if s.Owned {
			p("  `branch_id` VARCHAR(64) NULL,\n")
			cols = append(cols, "branch_id")
		}
		if s.Transfer {
			p("  `from_branch_id` VARCHAR(64) NULL,\n  `to_branch_id` VARCHAR(64) NULL,\n")
			cols = append(cols, "from_branch_id", "to_branch_id")
		}
		if s.Numbered != "" {
			p("  `doc_no` VARCHAR(60) NULL,\n")
			cols = append(cols, "doc_no")
		}
		for _, c := range s.Columns {
			p("  `%s` %s NULL,\n", c.Name, c.Type)
			cols = append(cols, c.Name)
		}
		p("  `data` JSON NOT NULL,\n  `created_at` DATETIME NULL,\n  `updated_at` DATETIME NULL,\n  PRIMARY KEY (`id`)")
		cols = append(cols, "data", "created_at", "updated_at")
		if s.Owned {
			p(",\n  KEY `idx_branch` (`branch_id`)")
		}
		if s.Numbered != "" {
			p(",\n  UNIQUE KEY `uq_doc_no` (`doc_no`)")
		}
		p("\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\n")

		records, err := app.FindAllRecords(s.Name)
		if err != nil {
			return err
		}
		for i, r := range records {
			if i%200 == 0 {
				if i > 0 {
					p(";\n")
				}
				p("INSERT INTO `%s` (`%s`) VALUES\n", table, strings.Join(cols, "`, `"))
			} else {
				p(",\n")
			}
			data := appData(r)
			vals := []string{sqlString(r.Id)}
			if s.Owned {
				vals = append(vals, sqlValue(nullIfEmpty(r.GetString("branchId")), "VARCHAR(64)"))
			}
			if s.Transfer {
				vals = append(vals, sqlValue(nullIfEmpty(r.GetString("fromBranchId")), "VARCHAR(64)"), sqlValue(nullIfEmpty(r.GetString("toBranchId")), "VARCHAR(64)"))
			}
			if s.Numbered != "" {
				vals = append(vals, sqlValue(nullIfEmpty(r.GetString("docNo")), "VARCHAR(60)"))
			}
			for _, c := range s.Columns {
				vals = append(vals, sqlValue(data[c.Key], c.Type))
			}
			raw, _ := json.Marshal(data)
			vals = append(vals, sqlString(string(raw)), sqlDateTime(r, "created"), sqlDateTime(r, "updated"))
			p("  (%s)", strings.Join(vals, ", "))
		}
		if len(records) > 0 {
			p(";\n")
		}
		p("\n")
	}

	// users
	p("-- Users (passwords are bcrypt hashes; they keep working with any bcrypt library)\n")
	p("DROP TABLE IF EXISTS `jw_users`;\nCREATE TABLE `jw_users` (\n  `id` VARCHAR(64) NOT NULL,\n  `username` VARCHAR(60) NOT NULL,\n  `name` VARCHAR(120) NULL,\n  `role` VARCHAR(10) NOT NULL,\n  `branch_id` VARCHAR(64) NOT NULL,\n  `is_master` BOOLEAN NOT NULL DEFAULT 0,\n  `active` BOOLEAN NOT NULL DEFAULT 1,\n  `must_change_password` BOOLEAN NOT NULL DEFAULT 0,\n  `password_hash` VARCHAR(255) NOT NULL,\n  `created_at` DATETIME NULL,\n  PRIMARY KEY (`id`),\n  UNIQUE KEY `uq_username` (`username`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\n")
	staff, err := app.FindAllRecords(staffCollection)
	if err != nil {
		return err
	}
	for i, u := range staff {
		if i == 0 {
			p("INSERT INTO `jw_users` (`id`, `username`, `name`, `role`, `branch_id`, `is_master`, `active`, `must_change_password`, `password_hash`, `created_at`) VALUES\n")
		} else {
			p(",\n")
		}
		b := func(f string) string { return sqlValue(u.GetBool(f), "BOOLEAN") }
		hash := ""
		if pv, ok := u.GetRaw("password").(*core.PasswordFieldValue); ok {
			hash = pv.Hash
		}
		p("  (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)", sqlString(u.Id), sqlString(u.GetString("username")), sqlString(u.GetString("name")),
			sqlString(u.GetString("role")), sqlString(u.GetString("branchId")), b("isMaster"), b("active"), b("mustChangePassword"),
			sqlString(hash), sqlDateTime(u, "created"))
	}
	if len(staff) > 0 {
		p(";\n")
	}

	// settings and counters
	p("\n-- Shop settings (WhatsApp / Razorpay secret keys are not exported: enter them again)\n")
	p("DROP TABLE IF EXISTS `jw_settings`;\nCREATE TABLE `jw_settings` (`id` VARCHAR(64) NOT NULL, `data` JSON NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n")
	if r, err := app.FindRecordById("appSettings", "main"); err == nil {
		raw, _ := json.Marshal(appData(r))
		p("INSERT INTO `jw_settings` (`id`, `data`) VALUES ('main', %s);\n", sqlString(string(raw)))
	}
	p("\n-- Running document number counters (continue numbering from here)\n")
	p("DROP TABLE IF EXISTS `jw_counters`;\nCREATE TABLE `jw_counters` (`id` VARCHAR(64) NOT NULL, `value` BIGINT NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n")
	counters, _ := app.FindAllRecords("counters")
	for i, c := range counters {
		if i == 0 {
			p("INSERT INTO `jw_counters` (`id`, `value`) VALUES\n")
		} else {
			p(",\n")
		}
		p("  (%s, %d)", sqlString(c.Id), c.GetInt("value"))
	}
	if len(counters) > 0 {
		p(";\n")
	}
	p("\nSET FOREIGN_KEY_CHECKS = 1;\n-- End of export\n")
	return bw.Flush()
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func registerExportRoutes(app core.App) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.GET("/api/jw/export/mysql", func(re *core.RequestEvent) error {
			if !isMasterUser(re, "Admin") {
				return re.ForbiddenError("Only the head office Admin can export the database.", nil)
			}
			name := "jewelleryapp-mysql-" + time.Now().Format("20060102-1504") + ".sql"
			re.Response.Header().Set("Content-Type", "application/sql; charset=utf-8")
			re.Response.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
			re.Response.WriteHeader(http.StatusOK)
			return writeMySQL(re.App, re.Response)
		}).Bind(apis.RequireAuth(staffCollection))
		return e.Next()
	})
}

func registerCommands(app *pocketbase.PocketBase) {
	var out string
	exp := &cobra.Command{
		Use:   "export-mysql",
		Short: "Export all data as a MySQL 8 / MariaDB script",
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := app.RunAllMigrations(); err != nil {
				return err
			}
			if err := ensureSchema(app); err != nil {
				return err
			}
			if out == "" {
				out = "jewelleryapp-mysql-" + time.Now().Format("20060102-1504") + ".sql"
			}
			f, err := os.Create(out)
			if err != nil {
				return err
			}
			defer f.Close()
			if err := writeMySQL(app, f); err != nil {
				return err
			}
			fmt.Println("MySQL export written to", out)
			return nil
		},
	}
	exp.Flags().StringVar(&out, "out", "", "output .sql file")
	app.RootCmd.AddCommand(exp)

	app.RootCmd.AddCommand(&cobra.Command{
		Use:   "backup",
		Short: "Create a backup now into the configured backup folder",
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := app.RunAllMigrations(); err != nil {
				return err
			}
			if err := setupDatabase(app); err != nil {
				return err
			}
			st := runBackup(app, "command line")
			if !st.OK {
				return fmt.Errorf("backup failed: %s", st.Error)
			}
			fmt.Println("Backup written to", st.Copy)
			return nil
		},
	})
}
