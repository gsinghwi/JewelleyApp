# Moving the data from the built-in database to MySQL

JewelleryApp stores its data in a built-in database (PocketBase, which uses SQLite). It needs no setup and no separate database program. If you later want the data in **MySQL**, for a new system, a website, Power BI / Excel reports or a central server, JewelleryApp exports everything as **one MySQL script**. Any MySQL 8.0+ or MariaDB 10.5+ server can import it.

> **Important:** the JewelleryApp screens and the Windows installer work with the built-in database. After the export, MySQL holds a complete copy of the data in tables that are easy to read. A program or developer can use it as the starting point for a MySQL-based system, or for reporting. Keep JewelleryApp running until the new system is ready. You can repeat the export as often as you like.

## What is exported

| Included | Not included |
|---|---|
| All branches, master data (items, purities, HSN, stones, payment modes, groups, currencies, templates), rates history | WhatsApp access token and Razorpay Key Secret. These are never exported; enter them again in the new system. |
| Customers, vendors, stock, purchases, vendor payments, invoices, receipts, pawn loans, online payments, transfers, WhatsApp log, activity log | Login sessions |
| Users with role, branch and **encrypted (bcrypt) passwords**, so users can keep their passwords in a new system | |
| Settings (including the logo and login image, stored as embedded images) and the document-number counters | |

## Step 1: Install MySQL (on the same laptop or another computer)

Choose one:

- **MySQL Community Server 8.x** (Windows "MySQL Installer", *Server only*). It needs about 1 GB RAM and runs as a Windows service.
- **MariaDB 10.5 or newer** (Windows MSI). It is lighter, and the same script works.
- A **cloud MySQL** (AWS RDS, Azure Database for MySQL, Google Cloud SQL, or a hosting provider's MySQL).

Note the root password you set during the install.

## Step 2: Create the database and a user

Open **MySQL Command Line Client** (or MySQL Workbench) and run:

```sql
CREATE DATABASE jewelleryapp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'jewellery'@'localhost' IDENTIFIED BY 'choose-a-strong-password';
GRANT ALL PRIVILEGES ON jewelleryapp.* TO 'jewellery'@'localhost';
FLUSH PRIVILEGES;
```

## Step 3: Export from JewelleryApp

**Option A: from the app (easiest)**

1. Sign in as the head office **Admin**.
2. **Settings & Branding > Daily backup > Export for MySQL**.
3. A file named like `jewelleryapp-mysql-20261024-1830.sql` downloads to your Downloads folder.

**Option B: from the command line** (also works when the app's window is not available)

Open **Command Prompt as administrator**:

```
cd "C:\Program Files\JewelleryApp"
jewellery-server export-mysql --out "C:\Temp\jewelleryapp.sql"
```

The export only reads the data, so it can run while the app is in use. A bill saved during the export may or may not be included. For the final move, stop billing first (see step 6).

## Step 4: Import into MySQL

In a Command Prompt (in MySQL's `bin` folder, or with it on the PATH):

```
mysql -u jewellery -p jewelleryapp < "C:\Users\<you>\Downloads\jewelleryapp-mysql-20261024-1830.sql"
```

Enter the password from step 2. The script creates (or re-creates) the `jw_...` tables and inserts all rows. Running it again replaces the tables with the newer export.

With **MySQL Workbench** instead: **Server > Data Import > Import from Self-Contained File**, choose the `.sql` file, set the target schema to `jewelleryapp`, and click **Start Import**.

## Step 5: Check the import

```sql
USE jewelleryapp;
SELECT 'invoices' t, COUNT(*) FROM jw_invoices UNION ALL
SELECT 'customers', COUNT(*) FROM jw_customers UNION ALL
SELECT 'stock', COUNT(*) FROM jw_stock UNION ALL
SELECT 'pawns', COUNT(*) FROM jw_pawns UNION ALL
SELECT 'users', COUNT(*) FROM jw_users;

-- sales total per branch, compare with Reports in JewelleryApp
SELECT branch_id, COUNT(*) bills, SUM(grand_total) total
FROM jw_invoices WHERE status <> 'CANCELLED' GROUP BY branch_id;
```

The counts must match what JewelleryApp shows: **Reports**, the **Stock** totals, and the list counts on each screen.

## Step 6: Final move (cut-over)

When the new MySQL-based system is ready:

1. Pick a time when the shop is closed. Ask everyone to close JewelleryApp.
2. Take a normal backup: **Settings > Daily backup > Back up now**. Keep it safe.
3. Export again (step 3) and import into MySQL (step 4). This copy now has every last bill.
4. Check the counts (step 5).
5. Point the new system at MySQL. Enter the WhatsApp token and Razorpay secret there again.
6. Stop JewelleryApp's database so nobody keeps billing in the old system: `jewellery-server service stop`. Set the **JewelleryApp Database** service to *Disabled* in `services.msc`. Keep the installation (read-only) and its backups for your records.

## How the tables are organised

Every JewelleryApp collection becomes one table named `jw_<collection>`. Each table has:

- `id`: the same record id as in JewelleryApp, so links between tables keep working (e.g. `jw_invoices.customer_id` = `jw_customers.id`);
- **key columns** for searching and reports (below);
- `data`: a **JSON** column with the complete record, including every field and nested list such as invoice lines or pawn items;
- `created_at` and `updated_at`.

| Table | Key columns (besides `id`, `data`, `created_at`, `updated_at`) |
|---|---|
| jw_branches | code, name, type, gstin, active |
| jw_currencies | code, name, symbol, rate_to_inr |
| jw_categories | code, name |
| jw_metals | name |
| jw_purities | metal_id, name, fineness |
| jw_hsn | code, gst_pct, description |
| jw_stoneTypes | name, unit, rate |
| jw_paymentModes | name, active |
| jw_customerGroups | name, making_discount_pct |
| jw_items | code, name, category_id, metal_id, purity_id, hsn, pricing, making_type, making_value, active |
| jw_rates | rated_at, source, entered_by (rates per purity are in `data.values`) |
| jw_waTemplates | name, type, meta_template |
| jw_waLog | sent_at, type, name, phone, status |
| jw_vendors | code, name, gstin, phone, city |
| jw_purchases | branch_id, doc_no (purchase no.), vendor_id, bill_no, bill_date, total, paid |
| jw_vendorPayments | branch_id, vendor_id, paid_on, amount, mode |
| jw_customers | branch_id, doc_no (customer code), name, phone, city, pan, gstin, dob, anniversary |
| jw_stock | branch_id, doc_no (tag no.), item_id, purity_id, gross_wt, net_wt, huid, status, vendor_id, cost_price |
| jw_invoices | branch_id, doc_no (invoice no.), invoice_date, customer_id, taxable, cgst, sgst, igst, grand_total, paid, balance, status |
| jw_receipts | branch_id, doc_no (receipt no.), customer_id, receipt_date, amount, mode |
| jw_pawns | branch_id, doc_no (pawn no.), customer_id, pawn_date, due_date, principal, interest_pct, net_wt, status |
| jw_gatewayPayments | branch_id, payment_id, amount, status, method, invoice_no |
| jw_transfers | from_branch_id, to_branch_id, doc_no (transfer no.), transfer_date, pieces, net_wt |
| jw_audit | at, user, action, col |
| jw_users | username, name, role, branch_id, is_master, active, must_change_password, password_hash |
| jw_settings | one row `main`, all settings in `data` |
| jw_counters | the last number used for each document series (e.g. `invoice-br_ho-2026-27`) and stock tags (`tag`) |

On **Windows**, MySQL stores table names in lower case by default (`jw_stonetypes`, `jw_paymentmodes`, ...). Use those names in queries there.

### Reading nested data (JSON)

Invoice lines, payments, pawn items and so on are inside `data`. MySQL 8 can turn them into rows:

```sql
-- every piece sold, with weight and amount
SELECT i.doc_no, i.invoice_date, l.tag_no, l.item, l.net_wt, l.amount
FROM jw_invoices i,
     JSON_TABLE(i.data, '$.lines[*]' COLUMNS (
       tag_no VARCHAR(40) PATH '$.tagNo',
       item   VARCHAR(150) PATH '$.itemName',
       net_wt DECIMAL(10,3) PATH '$.netWt',
       amount DECIMAL(14,2) PATH '$.amount')) l
WHERE i.status <> 'CANCELLED';

-- payment modes used on bills
SELECT p.mode, SUM(p.amount) total
FROM jw_invoices i,
     JSON_TABLE(i.data, '$.payments[*]' COLUMNS (mode VARCHAR(60) PATH '$.mode', amount DECIMAL(14,2) PATH '$.amount')) p
GROUP BY p.mode;

-- any single field
SELECT doc_no, data->>'$.createdBy' AS billed_by FROM jw_invoices;
```

(MariaDB supports `JSON_TABLE` from version 10.6. On 10.5 use `JSON_EXTRACT`.)

### Passwords

`jw_users.password_hash` holds standard **bcrypt** hashes (`$2a$10$...`). Most platforms can check them directly, so staff keep their passwords:

- PHP `password_verify()`;
- Node.js `bcrypt.compare()`;
- Java Spring `BCryptPasswordEncoder`;
- Python `bcrypt.checkpw()`;
- .NET `BCrypt.Net.BCrypt.Verify()`.

## Keeping a MySQL copy updated every night (optional)

For reports in MySQL while you keep using JewelleryApp, schedule the export and import with Windows Task Scheduler:

1. Create `C:\JewelleryApp-mysql\sync.bat`:

```bat
@echo off
cd /d "C:\Program Files\JewelleryApp"
jewellery-server export-mysql --out "C:\JewelleryApp-mysql\latest.sql" || exit /b 1
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" --defaults-extra-file="C:\JewelleryApp-mysql\my.cnf" jewelleryapp < "C:\JewelleryApp-mysql\latest.sql"
```

2. Create `C:\JewelleryApp-mysql\my.cnf`, readable only by administrators:

```ini
[client]
user=jewellery
password=choose-a-strong-password
host=localhost
```

3. In **Task Scheduler**, create a task:
   - **Run whether user is logged on or not** and **Run with highest privileges**;
   - trigger: daily at 22:00, after the backup;
   - action: start `C:\JewelleryApp-mysql\sync.bat`.

Each run replaces the MySQL tables with a fresh copy. Treat this copy as **read-only**: changes made in MySQL are not sent back to JewelleryApp.

## Going back

The export never changes JewelleryApp's own database. To undo a cut-over, start the **JewelleryApp Database** service again (set it back to *Automatic*). If you need the state at the cut-over moment, restore the backup taken in step 6.2 (see [Backup and restore](BACKUP-RESTORE.html)).
