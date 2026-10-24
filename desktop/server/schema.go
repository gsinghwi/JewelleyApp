package main

// Database layout.
//
// Every business collection stores the app's record as JSON in a `data` field, plus a few
// top-level columns the server needs for access rules, numbering and uniqueness
// (branchId, docNo, transfer branches). The app's own ids ("inv_1", "itm_GR-LAD", "G22K") are
// kept as PocketBase record ids, so nothing has to be renamed when data moves.
//
// The same definitions drive the MySQL export (export.go): every collection becomes a table
// with the listed key columns pulled out of the JSON and the full record kept in a JSON column.

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
)

const staffCollection = "staff"

// Rule building blocks (PocketBase filter syntax)
const (
	ruleAuth    = `@request.auth.collectionName = "staff" && @request.auth.active = true`
	ruleMaster  = ruleAuth + ` && @request.auth.isMaster = true`
	ruleManager = ` && (@request.auth.role = "Admin" || @request.auth.role = "Manager")`
	ruleAdmin   = ` && @request.auth.role = "Admin"`

	// Branch-owned records: master branch users see all, branch users only their own branch.
	ruleOwnedRead = ruleAuth + ` && (@request.auth.isMaster = true || branchId = @request.auth.branchId || branchId = "")`
	// Head office Admin / Manager may work for any branch; everyone else only for their own branch.
	ruleOwnedCreate = ruleAuth + ` && (@request.body.branchId = @request.auth.branchId || (@request.auth.isMaster = true` + ruleManager + `))`
	ruleOwnedUpdate = ruleAuth + ` && ((branchId = @request.auth.branchId && (@request.body.branchId:isset = false || @request.body.branchId = @request.auth.branchId)) || (@request.auth.isMaster = true` + ruleManager + `))`
	ruleOwnedDelete = ruleAuth + ruleManager + ` && (@request.auth.isMaster = true || branchId = @request.auth.branchId)`
)

// Column is a MySQL column extracted from the record JSON for reporting / indexing.
type Column struct {
	Name string // MySQL column name
	Key  string // key inside the record JSON
	Type string // MySQL type
}

type Spec struct {
	Name     string
	Title    string
	Owned    bool   // has branchId and branch access rules
	Numbered string // data key that receives a server-assigned document number ("" = none)
	Transfer bool   // has fromBranchId / toBranchId
	List     string
	Create   string
	Update   string
	Delete   string
	Columns  []Column
}

func ptr(s string) *string { return &s }

var specs = []Spec{
	// ---- shared master data (maintained by the master branch) ----
	{Name: "branches", Title: "Branches", List: ruleAuth, Create: ruleMaster + ruleAdmin, Update: ruleMaster + ruleAdmin, Delete: ruleMaster + ruleAdmin,
		Columns: []Column{{"code", "code", "VARCHAR(10)"}, {"name", "name", "VARCHAR(150)"}, {"type", "type", "VARCHAR(10)"}, {"gstin", "gstin", "VARCHAR(15)"}, {"active", "active", "BOOLEAN"}}},
	{Name: "currencies", Title: "Currencies", List: ruleAuth, Create: ruleMaster + ruleManager, Update: ruleMaster + ruleManager, Delete: ruleMaster + ruleAdmin,
		Columns: []Column{{"code", "code", "VARCHAR(3)"}, {"name", "name", "VARCHAR(60)"}, {"symbol", "symbol", "VARCHAR(5)"}, {"rate_to_inr", "rateToInr", "DECIMAL(18,6)"}}},
	{Name: "categories", Title: "Categories", List: ruleAuth, Create: ruleMaster + ruleManager, Update: ruleMaster + ruleManager, Delete: ruleMaster + ruleManager,
		Columns: []Column{{"code", "code", "VARCHAR(20)"}, {"name", "name", "VARCHAR(100)"}}},
	{Name: "metals", Title: "Metals", List: ruleAuth, Create: ruleMaster + ruleAdmin, Update: ruleMaster + ruleAdmin, Delete: ruleMaster + ruleAdmin,
		Columns: []Column{{"name", "name", "VARCHAR(60)"}}},
	{Name: "purities", Title: "Purities", List: ruleAuth, Create: ruleMaster + ruleAdmin, Update: ruleMaster + ruleAdmin, Delete: ruleMaster + ruleAdmin,
		Columns: []Column{{"metal_id", "metalId", "VARCHAR(64)"}, {"name", "name", "VARCHAR(60)"}, {"fineness", "fineness", "INT"}}},
	{Name: "hsn", Title: "HSN & GST", List: ruleAuth, Create: ruleMaster + ruleAdmin, Update: ruleMaster + ruleAdmin, Delete: ruleMaster + ruleAdmin,
		Columns: []Column{{"code", "code", "VARCHAR(10)"}, {"gst_pct", "gstPct", "DECIMAL(6,3)"}, {"description", "description", "VARCHAR(255)"}}},
	{Name: "stoneTypes", Title: "Stone types", List: ruleAuth, Create: ruleMaster + ruleManager, Update: ruleMaster + ruleManager, Delete: ruleMaster + ruleManager,
		Columns: []Column{{"name", "name", "VARCHAR(100)"}, {"unit", "unit", "VARCHAR(10)"}, {"rate", "rate", "DECIMAL(14,2)"}}},
	{Name: "paymentModes", Title: "Payment modes", List: ruleAuth, Create: ruleMaster + ruleManager, Update: ruleMaster + ruleManager, Delete: ruleMaster + ruleManager,
		Columns: []Column{{"name", "name", "VARCHAR(60)"}, {"active", "active", "BOOLEAN"}}},
	{Name: "customerGroups", Title: "Customer groups", List: ruleAuth, Create: ruleMaster + ruleManager, Update: ruleMaster + ruleManager, Delete: ruleMaster + ruleManager,
		Columns: []Column{{"name", "name", "VARCHAR(60)"}, {"making_discount_pct", "makingDiscountPct", "DECIMAL(6,2)"}}},
	{Name: "items", Title: "Item master", List: ruleAuth, Create: ruleMaster + ruleManager, Update: ruleMaster + ruleManager, Delete: ruleMaster + ruleManager,
		Columns: []Column{{"code", "code", "VARCHAR(30)"}, {"name", "name", "VARCHAR(150)"}, {"category_id", "categoryId", "VARCHAR(64)"}, {"metal_id", "metalId", "VARCHAR(64)"},
			{"purity_id", "purityId", "VARCHAR(64)"}, {"hsn", "hsn", "VARCHAR(10)"}, {"pricing", "pricing", "VARCHAR(10)"}, {"making_type", "makingType", "VARCHAR(10)"},
			{"making_value", "makingValue", "DECIMAL(14,2)"}, {"active", "active", "BOOLEAN"}}},
	{Name: "rates", Title: "Metal rates", List: ruleAuth, Create: ruleMaster + ruleManager, Update: ruleMaster + ruleAdmin, Delete: ruleMaster + ruleAdmin,
		Columns: []Column{{"rated_at", "at", "VARCHAR(30)"}, {"source", "source", "VARCHAR(200)"}, {"entered_by", "by", "VARCHAR(60)"}}},
	{Name: "waTemplates", Title: "WhatsApp templates", List: ruleMaster + ruleAdmin, Create: ruleMaster + ruleAdmin, Update: ruleMaster + ruleAdmin, Delete: ruleMaster + ruleAdmin,
		Columns: []Column{{"name", "name", "VARCHAR(100)"}, {"type", "type", "VARCHAR(20)"}, {"meta_template", "waTemplateName", "VARCHAR(100)"}}},
	{Name: "waLog", Title: "WhatsApp log", List: ruleMaster + ruleAdmin, Create: ruleMaster + ruleAdmin, Update: ruleMaster + ruleAdmin, Delete: ruleMaster + ruleAdmin,
		Columns: []Column{{"sent_at", "at", "VARCHAR(30)"}, {"type", "type", "VARCHAR(20)"}, {"name", "name", "VARCHAR(150)"}, {"phone", "phone", "VARCHAR(20)"}, {"status", "status", "VARCHAR(20)"}}},

	// ---- head office only ----
	{Name: "vendors", Title: "Vendors", List: ruleMaster, Create: ruleMaster + ruleManager, Update: ruleMaster + ruleManager, Delete: ruleMaster + ruleManager,
		Columns: []Column{{"code", "code", "VARCHAR(20)"}, {"name", "name", "VARCHAR(150)"}, {"gstin", "gstin", "VARCHAR(15)"}, {"phone", "phone", "VARCHAR(20)"}, {"city", "city", "VARCHAR(80)"}}},
	{Name: "purchases", Title: "Purchases", Owned: true, Numbered: "purchaseNo", List: ruleMaster, Create: ruleMaster + ruleManager, Update: ruleMaster + ruleManager, Delete: ruleMaster + ruleAdmin,
		Columns: []Column{{"vendor_id", "vendorId", "VARCHAR(64)"}, {"bill_no", "billNo", "VARCHAR(50)"}, {"bill_date", "billDate", "DATE"}, {"total", "total", "DECIMAL(14,2)"}, {"paid", "paid", "DECIMAL(14,2)"}}},
	{Name: "vendorPayments", Title: "Vendor payments", Owned: true, List: ruleMaster, Create: ruleMaster + ruleManager, Update: ruleMaster + ruleManager, Delete: ruleMaster + ruleAdmin,
		Columns: []Column{{"vendor_id", "vendorId", "VARCHAR(64)"}, {"paid_on", "date", "DATE"}, {"amount", "amount", "DECIMAL(14,2)"}, {"mode", "mode", "VARCHAR(40)"}}},

	// ---- branch-owned business data ----
	{Name: "customers", Title: "Customers", Owned: true, Numbered: "code", List: ruleOwnedRead, Create: ruleOwnedCreate, Update: ruleOwnedUpdate, Delete: ruleOwnedDelete,
		Columns: []Column{{"name", "name", "VARCHAR(150)"}, {"phone", "phone", "VARCHAR(20)"}, {"city", "city", "VARCHAR(80)"}, {"pan", "pan", "VARCHAR(10)"}, {"gstin", "gstin", "VARCHAR(15)"}, {"dob", "dob", "DATE"}, {"anniversary", "anniversary", "DATE"}}},
	{Name: "stock", Title: "Stock", Owned: true, Numbered: "tagNo", List: ruleOwnedRead, Create: ruleMaster + ruleManager, Update: ruleMaster + ruleManager, Delete: ruleMaster + ruleManager,
		Columns: []Column{{"item_id", "itemId", "VARCHAR(64)"}, {"purity_id", "purityId", "VARCHAR(64)"}, {"gross_wt", "grossWt", "DECIMAL(12,3)"}, {"net_wt", "netWt", "DECIMAL(12,3)"},
			{"huid", "huid", "VARCHAR(6)"}, {"status", "status", "VARCHAR(10)"}, {"vendor_id", "vendorId", "VARCHAR(64)"}, {"cost_price", "costPrice", "DECIMAL(14,2)"}}},
	{Name: "invoices", Title: "Sales invoices", Owned: true, Numbered: "invoiceNo", List: ruleOwnedRead, Create: ruleOwnedCreate, Update: ruleOwnedUpdate, Delete: ruleMaster + ruleAdmin,
		Columns: []Column{{"invoice_date", "date", "DATE"}, {"customer_id", "customerId", "VARCHAR(64)"}, {"taxable", "taxable", "DECIMAL(14,2)"}, {"cgst", "cgst", "DECIMAL(14,2)"},
			{"sgst", "sgst", "DECIMAL(14,2)"}, {"igst", "igst", "DECIMAL(14,2)"}, {"grand_total", "grandTotal", "DECIMAL(14,2)"}, {"paid", "paid", "DECIMAL(14,2)"},
			{"balance", "balance", "DECIMAL(14,2)"}, {"status", "status", "VARCHAR(12)"}}},
	{Name: "receipts", Title: "Customer receipts", Owned: true, Numbered: "receiptNo", List: ruleOwnedRead, Create: ruleOwnedCreate, Update: ruleMaster + ruleAdmin, Delete: ruleMaster + ruleAdmin,
		Columns: []Column{{"customer_id", "customerId", "VARCHAR(64)"}, {"receipt_date", "date", "DATE"}, {"amount", "amount", "DECIMAL(14,2)"}, {"mode", "mode", "VARCHAR(40)"}}},
	{Name: "pawns", Title: "Pawn loans", Owned: true, Numbered: "pawnNo", List: ruleOwnedRead, Create: ruleOwnedCreate + ruleManager, Update: ruleOwnedUpdate + ruleManager, Delete: ruleMaster + ruleAdmin,
		Columns: []Column{{"customer_id", "customerId", "VARCHAR(64)"}, {"pawn_date", "date", "DATE"}, {"due_date", "dueDate", "DATE"}, {"principal", "principal", "DECIMAL(14,2)"},
			{"interest_pct", "interestPct", "DECIMAL(6,3)"}, {"net_wt", "netWt", "DECIMAL(12,3)"}, {"status", "status", "VARCHAR(12)"}}},
	{Name: "gatewayPayments", Title: "Online payments", Owned: true, List: ruleOwnedRead, Create: ruleOwnedCreate, Update: ruleOwnedUpdate, Delete: ruleMaster + ruleAdmin,
		Columns: []Column{{"payment_id", "paymentId", "VARCHAR(64)"}, {"amount", "amount", "DECIMAL(14,2)"}, {"status", "status", "VARCHAR(12)"}, {"method", "method", "VARCHAR(20)"}, {"invoice_no", "invoiceNo", "VARCHAR(40)"}}},
	{Name: "transfers", Title: "Stock transfers", Owned: false, Transfer: true, Numbered: "transferNo",
		List:   ruleAuth + ` && (@request.auth.isMaster = true || fromBranchId = @request.auth.branchId || toBranchId = @request.auth.branchId)`,
		Create: ruleMaster + ruleManager, Update: ruleMaster + ruleManager, Delete: ruleMaster + ruleAdmin,
		Columns: []Column{{"transfer_date", "date", "DATE"}, {"pieces", "count", "INT"}, {"net_wt", "netWt", "DECIMAL(12,3)"}}},

	// ---- audit trail ----
	// written only by the server (audit.go); nobody can add, change or delete entries
	{Name: "audit", Title: "Audit log", List: ruleMaster + ruleAdmin, Create: "", Update: "", Delete: "",
		Columns: []Column{{"at", "at", "VARCHAR(30)"}, {"user", "user", "VARCHAR(60)"}, {"action", "action", "VARCHAR(20)"}, {"col", "col", "VARCHAR(40)"}}},
}

func specByName(name string) *Spec {
	for i := range specs {
		if specs[i].Name == name {
			return &specs[i]
		}
	}
	return nil
}

func ruleOrNil(r string) *string {
	if r == "" {
		return nil // superuser only
	}
	return ptr(r)
}

// App ids such as "itm_GR-LAD", "G22K", "7113" are kept as record ids.
func setIdField(c *core.Collection) {
	if f, ok := c.Fields.GetByName("id").(*core.TextField); ok {
		f.Pattern = `^[A-Za-z0-9_\-]+$`
		f.Min = 1
		f.Max = 64
		f.AutogeneratePattern = `[a-z0-9]{15}`
	}
}

func addAutodate(c *core.Collection) {
	if c.Fields.GetByName("created") == nil {
		c.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	}
	if c.Fields.GetByName("updated") == nil {
		c.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	}
}

// ensureSchema creates or updates every collection. Safe to run on each start.
func ensureSchema(app core.App) error {
	for _, s := range specs {
		c, _ := app.FindCollectionByNameOrId(s.Name)
		if c == nil {
			c = core.NewBaseCollection(s.Name)
		}
		setIdField(c)
		if c.Fields.GetByName("data") == nil {
			c.Fields.Add(&core.JSONField{Name: "data"})
		}
		// 1 MB per record is far more than any real bill / purchase needs; stops junk records filling the disk
		if f, ok := c.Fields.GetByName("data").(*core.JSONField); ok {
			f.MaxSize = 1 << 20
		}
		if s.Owned && c.Fields.GetByName("branchId") == nil {
			c.Fields.Add(&core.TextField{Name: "branchId", Max: 64})
		}
		if s.Transfer {
			for _, n := range []string{"fromBranchId", "toBranchId"} {
				if c.Fields.GetByName(n) == nil {
					c.Fields.Add(&core.TextField{Name: n, Max: 64})
				}
			}
		}
		if s.Numbered != "" && c.Fields.GetByName("docNo") == nil {
			c.Fields.Add(&core.TextField{Name: "docNo", Max: 60})
			c.AddIndex("idx_"+s.Name+"_docNo", true, "docNo", "docNo != ''")
		}
		if s.Owned {
			c.AddIndex("idx_"+s.Name+"_branch", false, "branchId", "")
		}
		addAutodate(c)
		c.ListRule = ruleOrNil(s.List)
		c.ViewRule = ruleOrNil(s.List)
		c.CreateRule = ruleOrNil(s.Create)
		c.UpdateRule = ruleOrNil(s.Update)
		c.DeleteRule = ruleOrNil(s.Delete)
		if err := app.Save(c); err != nil {
			return fmt.Errorf("collection %s: %w", s.Name, err)
		}
	}
	if err := ensureStaff(app); err != nil {
		return err
	}
	return ensureSystemCollections(app)
}

// Staff logins: username + password, one branch per user.
func ensureStaff(app core.App) error {
	c, _ := app.FindCollectionByNameOrId(staffCollection)
	if c == nil {
		c = core.NewAuthCollection(staffCollection)
	}
	setIdField(c)
	if f, ok := c.Fields.GetByName("email").(*core.EmailField); ok {
		f.Required = false
	}
	if f, ok := c.Fields.GetByName("password").(*core.PasswordField); ok {
		f.Min = 8
	}
	add := func(f core.Field) {
		if c.Fields.GetByName(f.GetName()) == nil {
			c.Fields.Add(f)
		}
	}
	add(&core.TextField{Name: "username", Required: true, Min: 3, Max: 60, Pattern: `^[a-zA-Z0-9_.\-]+$`})
	add(&core.TextField{Name: "name", Max: 120})
	add(&core.SelectField{Name: "role", Required: true, MaxSelect: 1, Values: []string{"Admin", "Manager", "Sales"}})
	add(&core.TextField{Name: "branchId", Required: true, Max: 64})
	add(&core.BoolField{Name: "isMaster"})
	add(&core.BoolField{Name: "active"})
	add(&core.BoolField{Name: "mustChangePassword"})
	addAutodate(c)
	c.AddIndex("idx_staff_username", true, "username", "")
	c.PasswordAuth.Enabled = true
	c.PasswordAuth.IdentityFields = []string{"username"}
	// Master-branch Admins manage users; everybody can see and update their own record
	// (role, branch and active flags are protected in hooks.go).
	selfOrAdmin := ruleAuth + ` && (id = @request.auth.id || (@request.auth.isMaster = true` + ruleManager + `))`
	c.ListRule = ptr(selfOrAdmin)
	c.ViewRule = ptr(selfOrAdmin)
	c.CreateRule = ptr(ruleMaster + ruleAdmin)
	c.UpdateRule = ptr(ruleAuth + ` && (id = @request.auth.id || (@request.auth.isMaster = true` + ruleAdmin + `))`)
	c.DeleteRule = ptr(ruleMaster + ruleAdmin)
	c.ManageRule = ptr(ruleMaster + ruleAdmin) // lets the Admin reset a forgotten password (no old password needed)
	c.AuthToken.Duration = 12 * 60 * 60        // a shop day
	return app.Save(c)
}

// Settings (public read for the branded login page), secrets and counters (server only).
func ensureSystemCollections(app core.App) error {
	type sys struct {
		name   string
		list   *string
		update *string
	}
	for _, s := range []sys{
		{"appSettings", ptr(ruleAuth), ptr(ruleMaster + ruleAdmin)}, // signed-in users only; the login page uses /api/jw/branding
		{"secrets", nil, nil},
		{"counters", nil, nil},
	} {
		c, _ := app.FindCollectionByNameOrId(s.name)
		if c == nil {
			c = core.NewBaseCollection(s.name)
		}
		setIdField(c)
		if s.name == "counters" {
			if c.Fields.GetByName("value") == nil {
				c.Fields.Add(&core.NumberField{Name: "value", OnlyInt: true})
			}
		} else {
			if c.Fields.GetByName("data") == nil {
				c.Fields.Add(&core.JSONField{Name: "data"})
			}
			if f, ok := c.Fields.GetByName("data").(*core.JSONField); ok {
				f.MaxSize = 3 << 20 // settings hold the logo and login picture (up to 600 KB each)
			}
		}
		addAutodate(c)
		c.ListRule = s.list
		c.ViewRule = s.list
		c.CreateRule = nil
		c.UpdateRule = s.update
		c.DeleteRule = nil
		if err := app.Save(c); err != nil {
			return fmt.Errorf("collection %s: %w", s.name, err)
		}
	}
	return nil
}
