# JewelleryApp desktop (Windows)

The production version of JewelleryApp for **Nisarg Jewellers**: the same screens as the online prototype, backed by a real database that runs on the shop laptop.

| Part | What it is |
|---|---|
| `server/` | `jewellery-server.exe`: a custom [PocketBase](https://pocketbase.io) (Go + SQLite) build with the JewelleryApp schema, access rules, document numbering, daily backups, WhatsApp / Razorpay integration, MySQL export and Windows service support. The web app (`server/web/`) is embedded in the exe. |
| `launcher/` | `JewelleryApp.exe`: opens the app in its own Edge / Chrome window once the database is up |
| `installer/` | NSIS script that installs both programs, registers the auto-start **JewelleryApp Database** service and adds shortcuts |
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
JEWELLERY_DATA_DIR=./pb_data JEWELLERY_HTTP=127.0.0.1:8090 go run .
# open http://127.0.0.1:8090 and sign in with admin / admin123
```

`jewellery-server` commands:

| Command | Does |
|---|---|
| (none) | Run the server on the configured address |
| `service install / uninstall / start / stop / restart / status` | Manage the Windows service |
| `backup` | Take a backup now (to the configured backup folder) |
| `restore --file <zip>` | Restore a backup (service must be stopped) |
| `export-mysql --out <file.sql>` | Export everything as a MySQL 8 script |
| `config --data-dir <dir> --http <addr>` | Write `jewellery.json` (used by the installer) |
| `version` | Print the version |

## How the data is stored

Each collection keeps the app record as JSON (`data`), plus indexed `branchId` and `docNo` fields:

- **Branch isolation:** server-side API rules make sure branch users can only read and write their own branch's records.
- **Document numbers:** invoices, receipts, pawn tickets, purchases, transfers, stock tags and customer codes are assigned by the server, per branch and financial year. No duplicates even with several counters billing at once.
- **Secrets:** Razorpay and WhatsApp keys are kept in a superuser-only collection and used only by the server.
