# JewelleryApp: user guide and setup

JewelleryApp is the billing, stock, CRM, pawn (girvi) and branch software for **Nisarg Jewellers**. It is a **browser application**:

- One Windows laptop (the "server laptop") runs the database, which starts and stops with Windows.
- On that laptop, open `http://localhost:8090`.
- On any other laptop, tablet or phone on the same Wi-Fi, open `http://<server laptop IP>:8090`. **Settings > Open on other laptops / tablets** shows the exact address.

| Guide | Read it when |
|---|---|
| [Installation](INSTALL.html) | Installing or upgrading on the laptop, opening the app from other devices |
| [Master data setup](MASTER-DATA.html) | After the first sign in: what is already loaded and what you must fill in |
| [Admin guide](ADMIN-GUIDE.html) | Users, branches, WhatsApp, Razorpay, security |
| [Backup and restore](BACKUP-RESTORE.html) | Setting the backup folder, restoring after a problem, moving to a new laptop |
| [Moving to MySQL](MIGRATE-TO-MYSQL.html) | You want the data in a MySQL database later |

**First sign in:** username `admin`, password `admin123`. You must choose a new password straight away.
