# Backup and restore

## How backups work

- Every day at the **backup time** (default 21:00), the database writes a complete backup zip, named for example `jewellery-20261024-210000.zip`. Taking it does not stop billing.
- The zip is copied to the **backup folder**. The last **N** zips are kept there (default 30); older ones are deleted.
- The 3 newest zips are also kept inside the data folder (`pb_data\backups`), in case the backup folder is unavailable.
- If the laptop was off at backup time, a catch-up backup runs about 3 minutes after the next start whenever the last good backup is more than 26 hours old.
- The result of every backup is shown under **Settings > Daily backup** and written to `logs\server.log`.

Each zip contains the whole database: master data, stock, bills, customers, pawn loans, users (with encrypted passwords), settings, and the WhatsApp and Razorpay keys. **Keep backups private.**

## Setting the backup folder, time and retention

1. Sign in as the head office **Admin**.
2. Open **Settings & Branding > Daily backup**.
3. **Backup folder:** a folder *on the server laptop*. Good choices:
   - a second drive, e.g. `D:\JewelleryBackups`;
   - a USB drive that is always plugged in, e.g. `E:\JewelleryBackups`;
   - a folder synced to the cloud, e.g. `C:\Users\<you>\OneDrive\JewelleryBackups` or a Google Drive for desktop folder. This gives you an off-site copy automatically.

   The folder is created if it does not exist. The database runs as the Windows *Local System* account, which can write to local drives and USB drives. Network shares (`\\server\share`) need extra permissions and are not recommended.
4. **Daily backup time:** choose a time when the laptop is usually on, such as just before closing.
5. **Keep last N backups:** 30 is about one month of daily backups.
6. Click **Save settings**. The new time takes effect immediately.
7. Click **Back up now** and check that the new file appears in the list.

**Advice:** at least once a week, copy the newest zip somewhere away from the shop (cloud folder, pen drive kept at home). A backup on the same laptop does not help if the laptop is stolen or damaged.

You can also take a backup from an administrator Command Prompt in `C:\Program Files\JewelleryApp`:

```
jewellery-server backup
```

## Restoring a backup

Restoring replaces **all** current data with the data in the backup. Anything entered after that backup was taken is lost.

1. Close JewelleryApp on all computers.
2. Open **Command Prompt as administrator** (Start, type `cmd`, right-click, **Run as administrator**).
3. Run:

```
cd "C:\Program Files\JewelleryApp"
jewellery-server service stop
jewellery-server restore --file "D:\JewelleryBackups\jewellery-20261024-210000.zip"
jewellery-server service start
```

4. Open JewelleryApp and sign in. Users and passwords are as they were in the backup.

The restore command does **not** delete your current data. It renames the current database folder to `pb_data-before-restore-<date-time>`. If you restored the wrong file, stop the service, rename the folders back, and start it again. Delete the old folder once you are sure.

## Moving to a new laptop

1. On the old laptop: **Settings > Daily backup > Back up now**. Copy the newest zip to a pen drive.
2. On the new laptop: run `JewelleryApp-Setup-<version>.exe`.
3. Restore the zip on the new laptop as described above (`service stop`, `restore --file ...`, `service start`).
4. Sign in with your usual username and password.
5. Check **Settings > Daily backup**. The backup folder came from the old laptop, so change it if that drive doesn't exist on the new one.
6. Uninstall JewelleryApp from the old laptop, or at least stop its service, so nobody keeps billing on it.

## Checking a backup

A backup is only useful if it restores. Every few months, restore the latest backup on a spare laptop (install JewelleryApp, then restore) and check that the latest bills are there.
