package main

// Business rules enforced by the server, so they hold even if someone bypasses the screens:
//  - bills: every line must be an in-stock piece of the bill's branch; the server marks the pieces
//    sold (one bill at a time, so a piece can never be sold twice). After saving, a bill can only
//    be cancelled (Admin / Manager), which puts the pieces back in stock. Totals cannot be edited.
//  - receipts: amount must be positive; the server settles the customer's oldest dues.
//  - stock: "sold" is set only by bills; pieces that are sold cannot be edited back or deleted.
//  - online payments: a paid Razorpay payment is recorded only by the server after Razorpay
//    confirms it; the app may only record failed attempts (and test payments in test mode).
//  - pawn loans: loan terms and items are fixed once saved; payments can only be added.
//  - document numbers are always assigned by the server (except stock tags) and never change.

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"sync"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

var saleMu sync.Mutex // one bill / cancellation at a time

var dateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func isManager(a *core.Record) bool {
	if a == nil {
		return false
	}
	r := a.GetString("role")
	return r == "Admin" || r == "Manager"
}

func numOf(m map[string]any, k string) float64 {
	switch v := m[k].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case json.Number:
		f, _ := v.Float64()
		return f
	}
	return 0
}

func listOf(m map[string]any, k string) []map[string]any {
	arr, _ := m[k].([]any)
	out := make([]map[string]any, 0, len(arr))
	for _, x := range arr {
		if o, ok := x.(map[string]any); ok {
			out = append(out, o)
		}
	}
	return out
}

func sameJSON(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}

// keepOnly returns the original data with only the listed keys taken from the new data
func keepOnly(orig, next map[string]any, keys ...string) map[string]any {
	out := map[string]any{}
	for k, v := range orig {
		out[k] = v
	}
	for _, k := range keys {
		if v, ok := next[k]; ok {
			out[k] = v
		} else {
			delete(out, k)
		}
	}
	return out
}

func superuser(e *core.RecordRequestEvent) bool { return e.HasSuperuserAuth() }

func registerBusinessRules(app core.App) {
	// ---------------- bills ----------------
	app.OnRecordCreateRequest("invoices").BindFunc(func(e *core.RecordRequestEvent) error {
		if superuser(e) {
			return e.Next()
		}
		d := appData(e.Record)
		branch := e.Record.GetString("branchId")
		if !dateRe.MatchString(str(d, "date", "")) {
			return e.BadRequestError("The bill needs a valid date.", nil)
		}
		lines := listOf(d, "lines")
		if len(lines) == 0 {
			return e.BadRequestError("A bill needs at least one item.", nil)
		}
		grand, paid, bal := numOf(d, "grandTotal"), numOf(d, "paid"), numOf(d, "balance")
		if paid < 0 || bal < -0.01 || math.Abs(grand-paid-bal) > 1 {
			return e.BadRequestError("The bill amounts do not add up (total, paid and balance).", nil)
		}
		sumPay := 0.0
		for _, p := range listOf(d, "payments") {
			if numOf(p, "amount") < 0 {
				return e.BadRequestError("Payment amounts cannot be negative.", nil)
			}
			sumPay += numOf(p, "amount")
		}
		if math.Abs(sumPay-paid) > 1 {
			return e.BadRequestError("The payments do not add up to the amount paid.", nil)
		}
		for _, l := range lines {
			if numOf(l, "amount") < 0 {
				return e.BadRequestError("Line amounts cannot be negative.", nil)
			}
		}
		d["status"] = "ACTIVE"
		d["settlements"] = []any{}
		d["createdBy"] = e.Auth.GetString("username")
		delete(d, "invoiceNo")
		e.Record.Set("data", d)

		saleMu.Lock()
		defer saleMu.Unlock()
		var pieces []*core.Record
		seen := map[string]bool{}
		for _, l := range lines {
			id := str(l, "stockId", "")
			if id == "" || seen[id] {
				return e.BadRequestError("Each bill line must be a different stock piece.", nil)
			}
			seen[id] = true
			s, err := e.App.FindRecordById("stock", id)
			if err != nil {
				return e.BadRequestError(fmt.Sprintf("Piece %s is not in stock.", str(l, "tagNo", id)), nil)
			}
			if s.GetString("branchId") != branch {
				return e.BadRequestError(fmt.Sprintf("Piece %s belongs to another branch.", s.GetString("docNo")), nil)
			}
			if str(appData(s), "status", "") != "IN_STOCK" {
				return e.BadRequestError(fmt.Sprintf("Piece %s is already sold.", s.GetString("docNo")), nil)
			}
			pieces = append(pieces, s)
		}
		if err := e.Next(); err != nil {
			return err
		}
		for _, s := range pieces {
			sd := appData(s)
			sd["status"] = "SOLD"
			sd["soldInvoiceId"] = e.Record.Id
			s.Set("data", sd)
			if err := e.App.Save(s); err != nil {
				e.App.Logger().Error("could not mark piece sold", "piece", s.Id, "invoice", e.Record.Id, "error", err)
			}
		}
		return nil
	})

	app.OnRecordUpdateRequest("invoices").BindFunc(func(e *core.RecordRequestEvent) error {
		if superuser(e) {
			return e.Next()
		}
		if !isManager(e.Auth) {
			return e.ForbiddenError("Bills cannot be changed after saving. Only an Admin or Manager can cancel a bill.", nil)
		}
		orig := appData(e.Record.Original())
		next := appData(e.Record)
		if str(next, "status", "") != "CANCELLED" || str(orig, "status", "") == "CANCELLED" {
			return e.BadRequestError("Bills cannot be edited after saving. Cancel the bill and make a new one.", nil)
		}
		d := keepOnly(orig, next, "status")
		d["cancelledBy"] = e.Auth.GetString("username")
		d["cancelledAt"] = next["cancelledAt"]
		d["updatedAt"] = next["updatedAt"]
		e.Record.Set("data", d)
		e.Record.Set("branchId", e.Record.Original().GetString("branchId"))

		saleMu.Lock()
		defer saleMu.Unlock()
		if err := e.Next(); err != nil {
			return err
		}
		for _, l := range listOf(orig, "lines") {
			s, err := e.App.FindRecordById("stock", str(l, "stockId", ""))
			if err != nil {
				continue
			}
			sd := appData(s)
			if str(sd, "soldInvoiceId", "") != e.Record.Id {
				continue
			}
			sd["status"] = "IN_STOCK"
			sd["soldInvoiceId"] = ""
			s.Set("data", sd)
			if err := e.App.Save(s); err != nil {
				e.App.Logger().Error("could not return piece to stock", "piece", s.Id, "error", err)
			}
		}
		return nil
	})

	// ---------------- receipts ----------------
	app.OnRecordCreateRequest("receipts").BindFunc(func(e *core.RecordRequestEvent) error {
		if superuser(e) {
			return e.Next()
		}
		d := appData(e.Record)
		amount := numOf(d, "amount")
		if !(amount > 0) {
			return e.BadRequestError("The receipt amount must be more than zero.", nil)
		}
		if !dateRe.MatchString(str(d, "date", "")) {
			return e.BadRequestError("The receipt needs a valid date.", nil)
		}
		cid := str(d, "customerId", "")
		if _, err := e.App.FindRecordById("customers", cid); err != nil {
			return e.BadRequestError("Choose the customer for this receipt.", nil)
		}
		d["by"] = e.Auth.GetString("username")
		delete(d, "receiptNo")
		e.Record.Set("data", d)

		saleMu.Lock()
		defer saleMu.Unlock()
		if err := e.Next(); err != nil {
			return err
		}
		settleDues(e.App, cid, amount, e.Record.GetString("docNo"), str(d, "date", ""))
		return nil
	})

	// ---------------- stock ----------------
	app.OnRecordUpdateRequest("stock").BindFunc(func(e *core.RecordRequestEvent) error {
		if superuser(e) {
			return e.Next()
		}
		orig := appData(e.Record.Original())
		d := appData(e.Record)
		// only bills change "sold"
		d["status"] = orig["status"]
		d["soldInvoiceId"] = orig["soldInvoiceId"]
		if str(orig, "status", "") == "SOLD" && e.Record.GetString("branchId") != e.Record.Original().GetString("branchId") {
			return e.BadRequestError("A sold piece cannot be transferred.", nil)
		}
		e.Record.Set("data", d)
		return e.Next()
	})
	app.OnRecordDeleteRequest("stock").BindFunc(func(e *core.RecordRequestEvent) error {
		if !superuser(e) && str(appData(e.Record), "status", "") == "SOLD" {
			return e.BadRequestError("A sold piece cannot be deleted. Cancel the bill first.", nil)
		}
		return e.Next()
	})

	// ---------------- online payments ----------------
	app.OnRecordCreateRequest("gatewayPayments").BindFunc(func(e *core.RecordRequestEvent) error {
		if superuser(e) {
			return e.Next()
		}
		d := appData(e.Record)
		status := str(d, "status", "")
		testMode := str(settingsData(e.App), "pgMode", "") == "SIMULATED"
		switch {
		case status == "failed":
		case str(d, "gateway", "") == "SIMULATED" && testMode:
			d["env"] = "test"
		default:
			return e.ForbiddenError("Online payments are recorded by the server when the payment gateway confirms them.", nil)
		}
		if numOf(d, "amount") < 0 {
			return e.BadRequestError("Amount cannot be negative.", nil)
		}
		d["by"] = e.Auth.GetString("username")
		e.Record.Set("data", d)
		return e.Next()
	})
	app.OnRecordUpdateRequest("gatewayPayments").BindFunc(func(e *core.RecordRequestEvent) error {
		if superuser(e) {
			return e.Next()
		}
		orig := appData(e.Record.Original())
		next := appData(e.Record)
		// linking a payment to its bill / receipt, and flagging a refund
		d := keepOnly(orig, next, "invoiceId", "invoiceNo", "customerId", "customerName", "receiptId", "receiptNo", "refundPending")
		if str(next, "status", "") == "refunded" && str(orig, "status", "") != "refunded" {
			if !isManager(e.Auth) {
				return e.ForbiddenError("Only an Admin or Manager can mark a payment refunded.", nil)
			}
			if s := str(orig, "status", ""); s != "captured" && s != "authorized" {
				return e.BadRequestError("Only a received payment can be refunded.", nil)
			}
			d["status"] = "refunded"
			d["refundPending"] = false
			d["refundedAt"] = next["refundedAt"]
			d["refundedBy"] = e.Auth.GetString("username")
		}
		e.Record.Set("data", d)
		e.Record.Set("branchId", e.Record.Original().GetString("branchId"))
		return e.Next()
	})

	// ---------------- pawn loans ----------------
	app.OnRecordCreateRequest("pawns").BindFunc(func(e *core.RecordRequestEvent) error {
		if superuser(e) {
			return e.Next()
		}
		d := appData(e.Record)
		items := listOf(d, "items")
		if len(items) == 0 {
			return e.BadRequestError("A pawn loan needs at least one item.", nil)
		}
		value := 0.0
		for _, it := range items {
			if !(numOf(it, "netWt") > 0) || numOf(it, "value") < 0 {
				return e.BadRequestError("Each pawned item needs its weight and value.", nil)
			}
			value += numOf(it, "value")
		}
		principal := numOf(d, "principal")
		if !(principal > 0) {
			return e.BadRequestError("Enter the loan amount.", nil)
		}
		if principal > value+0.5 {
			return e.BadRequestError("The loan cannot be more than the value of the items.", nil)
		}
		if numOf(d, "interestPct") < 0 || !dateRe.MatchString(str(d, "date", "")) {
			return e.BadRequestError("Check the pawn date and interest rate.", nil)
		}
		if _, err := e.App.FindRecordById("customers", str(d, "customerId", "")); err != nil {
			return e.BadRequestError("Choose the customer for this pawn loan.", nil)
		}
		d["status"] = "ACTIVE"
		d["payments"] = []any{}
		d["by"] = e.Auth.GetString("username")
		delete(d, "pawnNo")
		e.Record.Set("data", d)
		return e.Next()
	})
	app.OnRecordUpdateRequest("pawns").BindFunc(func(e *core.RecordRequestEvent) error {
		if superuser(e) {
			return e.Next()
		}
		orig := appData(e.Record.Original())
		next := appData(e.Record)
		op, np := listOf(orig, "payments"), listOf(next, "payments")
		if len(np) < len(op) {
			return e.BadRequestError("Recorded pawn payments cannot be removed.", nil)
		}
		for i := range op {
			if !sameJSON(op[i], np[i]) {
				return e.BadRequestError("Recorded pawn payments cannot be changed.", nil)
			}
		}
		for _, p := range np[len(op):] {
			if !(numOf(p, "amount") > 0) {
				return e.BadRequestError("A pawn payment must be more than zero.", nil)
			}
		}
		if str(orig, "status", "") != "ACTIVE" && !sameJSON(orig["status"], next["status"]) {
			return e.BadRequestError("This pawn loan is already closed.", nil)
		}
		switch st := str(next, "status", ""); st {
		case "ACTIVE", "REDEEMED", "FORFEITED":
		default:
			return e.BadRequestError("Unknown pawn status.", nil)
		}
		d := keepOnly(orig, next, "payments", "status", "closedOn", "dueDate", "extensions", "forfeitNotes", "forfeitedBy", "notes", "updatedAt")
		e.Record.Set("data", d)
		e.Record.Set("branchId", e.Record.Original().GetString("branchId"))
		return e.Next()
	})

	// ---------------- document numbers: always from the server, never changed ----------------
	for _, s := range specs {
		if s.Numbered == "" || s.Name == "stock" { // stock tags may be typed (existing barcode labels)
			continue
		}
		spec := s
		app.OnRecordCreateRequest(spec.Name).BindFunc(func(e *core.RecordRequestEvent) error {
			if !superuser(e) {
				d := appData(e.Record)
				delete(d, spec.Numbered)
				e.Record.Set("data", d)
			}
			return e.Next()
		})
		app.OnRecordUpdateRequest(spec.Name).BindFunc(func(e *core.RecordRequestEvent) error {
			if superuser(e) {
				return e.Next()
			}
			d := appData(e.Record)
			d[spec.Numbered] = e.Record.Original().GetString("docNo")
			e.Record.Set("data", d)
			return e.Next()
		})
	}
}

// settleDues applies a receipt to the customer's oldest bills that still have a balance
func settleDues(app core.App, customerId string, amount float64, receiptNo, date string) {
	invs, err := app.FindRecordsByFilter("invoices", "data.customerId = {:c}", "", 0, 0, dbx.Params{"c": customerId})
	if err != nil {
		app.Logger().Error("settle dues", "error", err)
		return
	}
	sort.Slice(invs, func(i, j int) bool { return str(appData(invs[i]), "date", "") < str(appData(invs[j]), "date", "") })
	left := amount
	for _, inv := range invs {
		if left <= 0.004 {
			break
		}
		d := appData(inv)
		bal := numOf(d, "balance")
		if str(d, "status", "") == "CANCELLED" || bal <= 0 {
			continue
		}
		part := math.Min(left, bal)
		d["balance"] = math.Round((bal-part)*100) / 100
		d["settlements"] = append(listAny(d["settlements"]), map[string]any{"receiptNo": receiptNo, "date": date, "amount": math.Round(part*100) / 100})
		inv.Set("data", d)
		if err := app.Save(inv); err != nil {
			app.Logger().Error("settle dues", "invoice", inv.Id, "error", err)
			continue
		}
		left -= part
	}
}

func listAny(v any) []any {
	if a, ok := v.([]any); ok {
		return a
	}
	return []any{}
}
