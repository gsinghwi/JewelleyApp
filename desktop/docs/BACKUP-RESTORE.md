# Backup and restore

## How backups work

- Every day at the **backup time** (default 21:00), the database writes a complete backup zip, named for example `jewellery-20261024-210000.zip`. Taking it does not stop billing.
- The backup is copied to the **backup folder**. Once you have set a **backup password**, the copy is **encrypted** and named `jewellery-...jwbackup`. The last **N** backups are kept there (default 30); older ones are deleted.
- The 3 newest zips are also kept inside the data folder (`pb_data\backups`), in case the backup folder is unavailable.
- If the laptop was off at backup time, a catch-up backup runs about 3 minutes after the next start whenever the last good backup is more than 26 hours old.
- The result of every backup is shown under **Settings > Daily backup** and written to `logs\server.log`.

Each backup contains the whole database: master data, stock, bills, customers, pawn loans, users (with encrypted passwords) and settings.

What is **not** in a backup:

- **The WhatsApp token and the Razorpay Key Secret.** They are stored encrypted, with a key file that stays on the server laptop (`<data folder>\keys\secrets.key`). A backup restored on another laptop does not include them. Enter them again in Settings, or copy that key file to the new laptop.
- **The emergency superuser login note.** It is kept in `<data folder>\superuser-login.txt`, outside the database folder.

## Backup password (encryption)

Until a backup password is set, the backups in the backup folder are ordinary zip files: anyone who gets one can read your customer data. The Admin sees a reminder at the top of the app until a password is set.

1. Open **Settings & Branding > Daily backup**.
2. Type a backup password of at least 10 characters, twice, then click **Set password and encrypt backups**.
3. **Write the password down and keep it away from the laptop**, for example with the shop's important papers at home. Without it, an encrypted backup **cannot be restored**, not even by support.
4. Click **Back up now**. The new file ends in `.jwbackup`.

Changing the password later only affects new backups. Older backups still need the password they were made with.

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
jewellery-server restore --file "D:\JewelleryBackups\jewellery-20261024-210000.jwbackup"
jewellery-server service start
```

   For an encrypted backup (`.jwbackup`), the command asks for the backup password. You can also add `--password "your backup password"` to the command. For a plain `.zip` backup, no password is needed.

4. Open JewelleryApp and sign in. Users and passwords are as they were in the backup.

**Restore is safe to try.** First it unpacks the backup to a temporary folder and checks that it is a complete, undamaged JewelleryApp database. It also checks the password, for an encrypted backup. Only then does it rename your current database folder to `pb_data-before-restore-<date-time>` and put the backup in its place.

If anything is wrong (wrong password, damaged file, not a JewelleryApp backup), the command stops with a message and **your current data is not touched**.

If you restored the wrong file, stop the service, rename the folders back, and start it again. Delete the old folder once you are sure.

## Moving to a new laptop

1. On the old laptop: **Settings > Daily backup > Back up now**. Copy the newest backup file to a pen drive.
   - Optional: also copy `<data folder>\keys\secrets.key`. Otherwise you will re-enter the Razorpay and WhatsApp keys after step 4.
2. On the new laptop: run `JewelleryApp-Setup-<version>.exe`.
3. Restore the backup on the new laptop as described above (`service stop`, `restore --file ...`, `service start`). Have the backup password ready.
   - If you copied `secrets.key`, put it in `<data folder>\keys\` on the new laptop **before** starting the service.
4. Sign in with your usual username and password. Enter the Razorpay and WhatsApp keys again in Settings if needed.
5. Check **Settings > Daily backup**. The backup folder came from the old laptop, so change it if that drive doesn't exist on the new one.
6. Uninstall JewelleryApp from the old laptop, or at least stop its service, so nobody keeps billing on it.

## Checking a backup

A backup is only useful if it restores. Every few months, restore the latest backup on a spare laptop (install JewelleryApp, then restore) and check that the latest bills are there.
