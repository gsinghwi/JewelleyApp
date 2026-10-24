# JewelleryApp desktop (Windows)

The production version of JewelleryApp for **Nisarg Jewellers**: the same screens as the online prototype, backed by a real database that runs on the shop laptop.

It is a **browser application**:

- The installer sets up the database and web server on one Windows laptop, as a service that starts with Windows.
- On that laptop, use `http://localhost:8090`.
- Other laptops, tablets and phones on the same Wi-Fi use `https://<laptop IP>:8443`, shown in **Settings**, after installing the shop certificate once from `http://<laptop IP>:8090/setup`. Nothing else is installed on them.

| Part | What it is |
|---|---|
| `server/` | `jewellery-server.exe`: a custom [PocketBase](https://pocketbase.io) (Go + SQLite) build with the JewelleryApp schema, access rules, document numbering, daily backups, WhatsApp / Razorpay integration, MySQL export and Windows service support. The web app (`server/web/`) is embedded in the exe. |
| `launcher/` | `JewelleryApp.exe`: the desktop shortcut; waits for the database, then opens `http://localhost:8090` in the default browser |
| `installer/` | NSIS script that installs both programs, registers the auto-start **JewelleryApp Database** service, opens port 8090 for private networks and adds shortcuts |
| `docs/` | User and admin guides, also installed with the app (Start menu > JewelleryApp > User guide and setup) |
| `tools/make-seed.js` | Regenerates `server/seed/default-data.json` (default master data) from the prototype's `js/seed.js` |

## Guides

- [Installation](docs/INSTALL.md)
- [Master data: what is loaded and what to set up](docs/MASTER-DATA.md)
- [Admin guide](docs/ADMIN-GUIDE.md): users, branches, WhatsApp, Razorpay, forgotten password
- [Backup and restore](docs/BACKUP-RESTORE.md)
- [Moving the data to MySQL](docs/MIGRATE-TO-MYSQL.md)

## Getting the installer

- **GitHub:** Actions > *Desktop installer* > latest run > artifact `JewelleryApp-Setup-<version>`. Tagging `desktop-v1.0.0` publishes it as a Release.
- **Build it yourself** (Linux, macOS or Git Bash on Windows; needs Go, NSIS and pandoc):

```
cd desktop
VERSION=1.0.0 ./build.sh      # -> build/JewelleryApp-Setup-1.0.0.exe
```

## Running the server for development

```
cd desktop/server
JEWELLERY_DATA_DIR=./pb_data go run .      # http 0.0.0.0:8090 + https 0.0.0.0:8443
# open http://localhost:8090 (or http://<this machine's IP>:8090 from another device), sign in with admin / admin123
```

`jewellery-server` commands:

| Command | Does |
|---|---|
| (none) | Run the server on the configured address |
| `service install / uninstall / start / stop / restart / status` | Manage the Windows service |
| `backup` | Take a backup now (to the configured backup folder) |
| `restore --file <zip or jwbackup> [--password X]` | Restore a backup, checked before it replaces anything (service must be stopped) |
| `export-mysql --out <file.sql>` | Export everything as a MySQL 8 script |
| `config --data-dir <dir> --http <addr> --https <addr>` | Write `jewellery.json` (used by the installer) |
| `version` | Print the version |

## How the data is stored

Each collection keeps the app record as JSON (`data`), plus indexed `branchId` and `docNo` fields:

- **Branch isolation:** server-side API rules make sure branch users can only read and write their own branch's records.
- **Document numbers:** invoices, receipts, pawn tickets, purchases, transfers, stock tags and customer codes are assigned by the server, per branch and financial year. No duplicates even with several counters billing at once.
- **Network:** HTTPS on `0.0.0.0:8443` with the shop's own certificate authority (`tls.go`; the server certificate covers every address of the laptop and is re-issued when the IP changes). Plain HTTP on `:8090` serves the app to the laptop itself (`localhost`) and only the device setup page to others. The PocketBase admin UI and superuser APIs only answer requests from the laptop itself.
- **Browser hardening:** Content-Security-Policy (no inline scripts; only this server and Razorpay), CORS limited to the app's own addresses, sign-in kept per browser tab with an idle sign-out, request rate limits, 1 MB per record.
- **Secrets:** Razorpay and WhatsApp keys are kept in a superuser-only collection, encrypted with a key file outside the database folder (so never in a backup), and used only by the server.
- **Backups:** encrypted with the Admin's backup password (AES-256-GCM, scrypt) once it is set. Restore validates a backup before swapping it in.
- **Activity log:** written by the server (`audit.go`); staff cannot create, edit or delete entries.
