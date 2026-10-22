# JewelleryApp

A working prototype of a shop-management app for an Indian jewellery store moving from manual registers to a digital system. It covers:

- Customers (CRM)
- Sales and POS billing
- GST invoices
- Daily metal rates
- Stock
- Purchases from vendors
- Master data
- Reports
- A login page with the shop's own branding

## Run it

There's no install or build step. Open `index.html` in Chrome, Edge or Firefox. You can also serve the folder:

```bash
cd JewelleryApp
python3 -m http.server 8080   # then open http://localhost:8080
```

Demo logins (change them under **Branches & Access** or **Settings → Users**):

| Branch | Role | Username | Password | Access |
|--------|------|----------|----------|--------|
| Head Office (master) | Admin | admin | admin123 | Everything, all branches, branches & users, settings |
| Head Office (master) | Manager | manager | manager123 | All branches; everything except settings and users |
| Head Office (master) | Sales | sales | sales123 | Head office billing, invoices, customers, stock (view) |
| Kothrud | Manager | kothrud.mgr | kothrud123 | Kothrud only: billing, invoices, customers, pawn loans, online payments, reports |
| Kothrud | Sales | kothrud.sales | kothrud123 | Kothrud only: billing, invoices, customers, stock (view) |
| Nashik | Manager | nashik.mgr | nashik123 | Nashik only (as Kothrud manager) |
| Nashik | Sales | nashik.sales | nashik123 | Nashik only (as Kothrud sales) |

## Branches

- **One master branch** (head office) and any number of sub-branches. Head office Admins create branches and users under **Branches & Access**. Every user belongs to exactly one branch, and Admin users must belong to the master branch.
- **Branch users only see their own branch:** its stock, sales and invoices, customers, receipts, pawn loans, online payments and reports. Records of other branches are hidden everywhere, including when a link to them is typed directly. Purchases, vendors, master data, settings, rates editing and branch management are head-office only.
- **Master users** pick **All branches (consolidated)** or any single branch in the top bar. The dashboard shows a per-branch comparison, and **Reports → Branch-wise summary** compares sales, GST, collections, dues, stock value and pawn loans for every branch.
- **Stock flow:** purchases and new pieces arrive at the master branch. Head office ticks pieces in **Stock → Transfer to branch** to send them to a branch (or back), and each transfer is recorded with a printable **delivery challan**. Branches can only sell stock that is at their branch.
- **Document numbers:** each branch has its own series, e.g. `INV/KTD/2026-27/0001`, `RCT/NSK/…`, `PWN/HO/…`, `TRF/HO/…`. Invoices print the branch's address (and its GSTIN if a different one is set).
- **Gold rates and master data** are shared by all branches and maintained by head office.

## Screens

| Screen | What it does |
|--------|--------------|
| **Login** | Branded with the shop's logo, name, tagline, colours, background image and welcome message (set in Settings). |
| **Dashboard** | Today's and this month's sales, stock in hand and its value at today's rate, customer dues, vendor payables, today's rates, a 7-day sales chart, recent bills, upcoming birthdays and anniversaries, and low-stock alerts. |
| **Today's Rates** | Enter the gold, silver and platinum rates per gram for every purity. "Auto-fill" works out 22K, 18K and 14K from 24K, and 925 silver from 999. Every rate change is kept in a history with a trend chart. Billing uses the latest saved rate, and it shows in the top bar on every screen. |
| **New Sale / Billing (POS)** | Scan a QR sticker with the camera (**Scan QR**: keeps scanning, so several pieces can be added in a row; a photo also works), use a USB/Bluetooth QR scanner, type a tag number or HUID, or browse stock. Each line is priced as net weight × rate + wastage/VA + making charge (percent, per gram or flat) + stone value + hallmark charge. Rate, making and VA can be edited per line. Customer-group making discounts apply automatically. The bill also handles discounts, old-gold exchange (deducted after GST), CGST/SGST or IGST, split payments and balance due. On save the invoice prints. |
| **Online Payments** (Admin, Manager) | Every online payment attempt: date, gateway payment and order IDs, customer, method (UPI / card network and last 4 digits / bank / wallet), amount, status (paid, authorized, failed, refunded), test or live, and the bill or receipt it belongs to. Filters, CSV export, a detail view, and "Mark refunded" for cancelled bills or unlinked payments. |
| **Sales & Invoices** | Search and filter bills, then view or print the branded GST tax invoice (with HUIDs and the amount in words), take payment against a due, or cancel a bill (its stock returns to inventory). |
| **WhatsApp** (Admin only) | **Wishes:** lists customers whose birthday or anniversary is due in 7 days (adjustable), with a send button for each and "Send all"; the dashboard also reminds you. **Promotional broadcast:** to all customers, by group or city, and/or all vendors. Contacts without a valid mobile, who haven't agreed to receive WhatsApp messages, or with a duplicate number are left out automatically. **Templates:** with `{name}`, `{shop}`, `{date}` and similar placeholders. **Message log:** with CSV export. |
| **Pawn / Girvi Loans** (Admin, Manager) | Pledge jewellery against a loan. Each item is weighed (gross, less stones/dirt, net) and valued at today's rate for its tested purity. The loan is limited to the loan-to-value (LTV) percentage (default 75%), and the screen shows monthly interest, due date and redemption amount. Supports part payments (interest due first, then principal), **redeem & release** with an items-handed-back check, extending the due date, and marking forfeited (Admin, after legal notice). Each loan prints a **pawn ticket** (customer and office copies) and a **packet QR sticker** whose QR code holds the pawn number, customer name, items, purities and weights; scan it (camera or USB scanner) to open the loan. Only the last 4 characters of the ID proof are stored. Cash payouts of ₹20,000 or more trigger a s.269SS warning. |
| **Customers** | Customer list and profile: contact details, group, PAN/GSTIN, birthday, anniversary, ring size, notes, purchase history, payments and outstanding. Payments received are set against the oldest open bills first. |
| **Stock** | Every tagged piece with item, purity, gross/stone/net weight, stone details and value, HUID, vendor, location and value at today's rate. You can filter, add or edit pieces, view each piece's **QR code**, and **print QR stickers** for the pieces you tick (or every piece shown). Stickers come in three sizes: jewellery dumbbell tag 95×12 mm, 50×25 mm label, or an A4 sheet of 65 labels. You choose which details appear and the number of copies. |
| **Purchases** | Stock inward from a vendor: one row per piece, with tags generated automatically and GST on the purchase. After saving, the app offers to print QR stickers for the new pieces. Also records vendor payments. |
| **Vendors** | Supplier list with a ledger for each (purchases, payments and amount payable). |
| **Master Data** | One screen for every master list: Item Master, Categories, Metals, Purity/Karat, HSN & GST, Stone Types, Payment Modes, Customer Groups, Customers, Vendors, and Users & Roles. Every list has search, add, edit, delete (blocked while a record is in use), and CSV export and import. |
| **Reports** | Any date range, with quick presets (today, this month, this financial year, …). Every report exports to CSV and prints or saves as PDF. |
| **Settings & Branding** | Logo, colours (with ready-made themes) and a live login-page preview. Also shop details (GSTIN, BIS licence, state), invoice/purchase/tag prefixes, the hallmark charge, invoice terms, an optional live rate feed URL, users, backup/restore and an activity log. |

### Reports

- **Sales:** Sales register, item/category/purity-wise sales, GST summary by HSN (B2B/B2C, for GSTR-1), collections by payment mode, old gold received, day book.
- **Stock:** Stock summary and valuation (gross, net and fine weight), tag-wise stock detail with age in days, re-order list.
- **Purchases:** Purchase register, vendor payables.
- **Customers:** Outstanding dues, top customers, upcoming birthdays and anniversaries.
- **Pawn:** Pawn loan register (with interest due today), pawn collections (interest and principal received).
- **Rates:** Rate history.

## Pre-loaded Item Master (113 items)

| Category | Items |
|----------|-------|
| **Gold (22K)** | Ladies, gents and navratna rings; couple bands; chains (plain, rope, box); necklace, choker, haar, rani haar; mangalsutra and mangalsutra chain; thali; pendants, lockets, god pendants; bangles, kada, bracelet, bajuband; kids' nazariya; jhumka, studs/tops, bali, chandbali, sui dhaga, danglers, kaan chain; nose pin, nath; maang tikka; passa/jhoomar; kamarbandh; haathphool; gold payal; bichhiya; cufflinks, tie pin, brooch, hair pin |
| **Temple** | Necklace, kasu mala / Lakshmi haar, jhumka, oddiyanam, vanki, nethi chutti |
| **Kundan & Polki** | Necklace sets, Polki necklace, Jadau earrings, maang tikka, bangles, nath |
| **Diamond (18K)** | Rings, solitaire, eternity band, earrings, pendant, necklace, bangle, bracelet, nose pin, mangalsutra |
| **Platinum (950)** | Ring, couple bands, chain, bracelet, pendant, earrings |
| **Silver jewellery** | Payal/pajeb, bichhiya, kada, chain, ring, bracelet, earrings, kamarbandh, oxidised necklace, nazariya |
| **Silver articles** | Glass, thali, katori, spoon, baby set, pooja thali, diya, kalash, idols, photo frame, kumkum dabbi, tray |
| **Bullion & coins** | Gold coins (1, 2, 5, 8 and 10 g), gold bars (50 and 100 g), silver coins (10, 20 and 50 g), silver bar (1 kg) |
| **Gemstones (Navratna)** | Manik, Panna, Pukhraj, Neelam, Moti, Moonga, Gomed, Lehsunia, Opal, Navratna set, certified loose diamond |

Each item carries HSN code and GST, default purity, pricing method (by weight or fixed MRP), making-charge type and value, wastage %, unit and re-order level.

Other master data also comes pre-loaded:

- **Purities:** 24K/999, 22K/916, 20K/833, 18K/750, 14K/585, Silver 999/925, Platinum 950.
- **HSN codes:** 7113, 7114, 7118, 7108, 7106, 7110, 7102 (0.25%), 7103, 7117.
- **Stone types,** payment modes and customer groups.

Demo vendors, customers, stock pieces and bills are included so every screen has data to show.

## India-specific rules built in

- GST at the HSN rate per line: CGST + SGST within the state, IGST between states. IGST switches on automatically when the customer's state differs from the shop's.
- **Section 269ST:** a bill is blocked if it takes ₹2 lakh or more in cash.
- **Rule 114B:** customer PAN is required on bills of ₹2 lakh or more.
- 6-character BIS HUID per piece, shown on the invoice and on tag labels.
- Old gold (URD) is valued at net weight after the melting deduction and taken off after GST.
- Document numbers run per financial year, e.g. `INV/2026-27/0001`.
- Amounts use Indian formatting (lakh/crore), and the amount in words follows the same system.

## Project layout

```
JewelleryApp/
├── index.html
├── css/styles.css         # theme comes from Settings via CSS variables
└── js/
    ├── utils.js           # formatting, dates, SHA-256, CSV, amount in words
    ├── pricing.js         # jewellery line pricing and invoice/GST maths
    ├── seed.js            # Indian item master and demo data
    ├── db.js              # data layer: the only file that touches storage
    ├── branch.js          # branches: current branch view, access filter, document series
    ├── ui.js              # modal, toast, forms, tables, generic master CRUD
    ├── auth.js            # login, roles, branded login page
    ├── biz.js             # shared business helpers
    ├── schemas.js         # field and column definitions for every master
    ├── whatsapp.js        # WhatsApp sending (click-to-chat links and Cloud API)
    ├── qr.js              # QR codes: stickers, printing, camera scanner
    ├── payments.js        # payment gateway: built-in test gateway + Razorpay checkout
    ├── pawn.js            # pawn loans: valuation, LTV limit, interest, repayments, QR text
    ├── vendor/            # qrcode-generator 1.4.4 (MIT), jsQR 1.4.0 (Apache-2.0)
    ├── app.js             # app shell, navigation, router
    └── pages/             # dashboard, rates, pos, sales, customers, stock,
                           # purchases, vendors, reports, masters, settings, whatsapp
```

## QR codes

- Each piece's QR code contains just its tag number (e.g. `T1001`). The same sticker works with the in-app camera scanner and with any USB/Bluetooth QR scanner gun, which types the code into the scan box.
- **Camera scanning** needs the app to be opened over `https` (for example the GitHub Pages link) or from `localhost`. Some browsers block the camera when `index.html` is opened directly as a file; **Scan from a photo** works everywhere.
- **Thermal label printers** (TSC, Zebra, Argox, TVS, …): in the print window, pick the label printer, set the paper size to the sticker size and margins to none. **A4 label sheets:** print at 100% / Actual size.

## Pawn / girvi interest

Interest is simple interest at a monthly rate on the principal outstanding, worked out between payments.

- **Monthly method** (default): a started month counts as a full month.
- **Daily method:** charges the exact days (rate × days ÷ 30).

A minimum period (default 1 month) is always charged. Payments go to interest due first, then to principal. Defaults (LTV, rate, method, minimum, tenure, number prefix, licence number, ticket terms) are set under **Pawn settings**.

Pawnbroking needs a state licence. Most states (under their Pawnbrokers or Money-Lending Acts) also cap the interest rate and set rules for pawn tickets, notices and auctions. Check your state's limits before setting the defaults.

## Online payments (payment gateway)

On the billing screen, **Collect online** takes all or part of a bill by UPI, card, net banking or wallet. The amount is added to the bill as a locked "Online - UPI/Card/…" payment with its gateway payment ID, and the rest can be paid by cash or another mode. Customer dues can also be paid online from **Receive payment → Collect online**, which creates the receipt automatically. Cancelling a bill that was paid online flags the payment as **Refund due**.

Choose the gateway under **Settings → Payment gateway**:

- **Test gateway (simulated):** the default. No account needed and no real money moves. Test with UPI `success@razorpay` / `failure@razorpay`, card `4111 1111 1111 1111` (success) or `4000 0000 0000 0002` (declined), or net banking/wallet with an optional "simulate failure" tick.
- **Razorpay:** paste your **Key ID** from Razorpay Dashboard → Account & Settings → API Keys. A `rzp_test_…` key gives test mode, where Razorpay's own test cards and UPI IDs work; a `rzp_live_…` key takes real payments. **Never enter the Key Secret in the app.**

Every attempt, successful or failed, is saved in the `gatewayPayments` collection of the app's data store. Card numbers, CVV and UPI PINs are never stored: only the gateway's payment ID, the method, and for cards the network and last 4 digits.

**Before going live with Razorpay:** a small server should create a Razorpay Order (using the Key Secret), verify the payment signature, capture the payment and receive webhooks. Until then, Razorpay payments are recorded as **Authorized** and must be captured in the Razorpay dashboard, or Razorpay refunds them automatically. This server step belongs with the move to a shared database.

## WhatsApp

There are two sending modes, chosen under WhatsApp → WhatsApp settings:

- **Click-to-chat** (default, free, no setup): WhatsApp Desktop or WhatsApp Web opens with the message typed in, and staff press Send. For broadcasts, the app steps through the contacts one at a time. Works with the shop's normal WhatsApp or WhatsApp Business app.
- **Automatic (WhatsApp Business Cloud API):** messages are sent without clicking, using Meta-approved templates. You need a Meta Business account, a verified business number, approved templates (with `{{1}}`, `{{2}}`, … in the same order as the placeholders here), and the phone number ID plus a permanent token. Meta charges per message. In this prototype the token is stored in the browser, and only Admins can see it; before going live, move sending to a server.

The app runs only while it is open, so birthday wishes are not sent on their own on a schedule. Open the WhatsApp screen (or the dashboard reminder) each day. Fully automatic daily sending needs a small server; see the next steps below.

## Prototype limits and next steps

- **Branches need shared storage to work across locations.** In this prototype each device keeps its own copy, so the branch separation can be tried fully on one device, but sales at a branch's own computer will not reach head office until the data moves to a shared database. The access filter also runs in the browser; on a server it must be enforced by the backend as well.
- **Storage:** data is kept in the browser (`localStorage`) on the computer where the app is used. Take regular backups (Settings → Download backup). To share data across counters or branches, replace `js/db.js` with calls to a backend API and database (for example Node or Django with PostgreSQL). All screens go through `DB`, so nothing else needs to change.
- **Security:** sign-in is checked inside the browser with salted SHA-256 hashes, which is fine for a demo. A production version needs server-side authentication.
- **Live rates:** set **Settings → Live rate feed URL** to an endpoint that returns JSON such as `{"G24K": 12850, "G22K": 11780, "S999": 165}`.
- **Possible additions:** scheduled automatic WhatsApp sending from a server, direct printing to label printers (raw TSPL/ZPL, no print dialog), sending bills on WhatsApp, SMS, e-invoicing/IRN, gold saving schemes, repair and custom orders, karigar job work and multi-branch support.
