# JewelleryApp desktop (Windows)

The production version of JewelleryApp for **Nisarg Jewellers**: the same screens as the online prototype, backed by a real database that runs on the shop laptop.

It is a **browser application**:

- The installer sets up the database and web server on one Windows laptop, as a service that starts with Windows.
- On that laptop, use `http://localhost:8090`.
- Other laptops, tablets and phones on the same Wi-Fi use `http://<laptop IP>:8090`, shown in **Settings**. Nothing is installed on them.

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
JEWELLERY_DATA_DIR=./pb_data go run .      # listens on 0.0.0.0:8090
# open http://localhost:8090 (or http://<this machine's IP>:8090 from another device), sign in with admin / admin123
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
- **Network:** the server listens on all network cards (`0.0.0.0:8090`; set `httpAddr` in `jewellery.json` to `127.0.0.1:8090` for this laptop only). The PocketBase admin UI and superuser APIs only answer requests from the laptop itself.
- **Secrets:** Razorpay and WhatsApp keys are kept in a superuser-only collection and used only by the server.
