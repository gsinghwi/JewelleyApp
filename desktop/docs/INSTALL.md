# Installing JewelleryApp

## What you need

- A Windows 10 or 11 laptop (64-bit) with at least 4 GB RAM and 2 GB free disk space.
- Microsoft Edge (built into Windows) or Google Chrome.
- Internet access only for live gold rates, WhatsApp and Razorpay. Billing, stock and pawn work offline.

## Install

1. Copy `JewelleryApp-Setup-<version>.exe` to the laptop and double-click it.
2. Windows asks "Do you want to allow this app to make changes?". Click **Yes**. Administrator rights are needed to register the database service.
   - The installer is not code-signed, so Windows SmartScreen may show "Windows protected your PC". Click **More info**, then **Run anyway**.
3. **Program folder:** keep `C:\Program Files\JewelleryApp`.
4. **Data folder:** keep `C:\ProgramData\JewelleryApp`, or choose another folder on a local drive (for example `D:\JewelleryData`). It holds:
   - `pb_data\`: the database. Never edit or delete it.
   - `backups\`: the default daily backup folder. You can change it later in Settings.
   - `logs\server.log`: the database log.
5. Click **Install**. The installer:
   - copies the programs;
   - writes `jewellery.json` (the data folder and address) next to the programs;
   - registers the Windows service **JewelleryApp Database**, set to *Automatic*, and starts it;
   - adds a **JewelleryApp** shortcut to the desktop and the Start menu.
6. Leave **Open JewelleryApp now** ticked and click **Finish**.

On first start the database creates its tables and loads the default master data (see [Master data setup](MASTER-DATA.html)). It also creates the user **admin / admin123**.

## First sign in

1. Open **JewelleryApp** from the desktop. It opens in its own window, without an address bar.
2. Sign in with `admin` / `admin123`.
3. Choose a new password: at least 8 characters, and not `admin123`. The app does not open until you do.
4. Follow [Master data setup](MASTER-DATA.html).

## Starting and stopping

You do not need to start anything by hand.

- When the laptop starts, Windows starts **JewelleryApp Database** before anyone signs in.
- When the laptop shuts down or restarts, Windows stops the service. The database is closed cleanly.
- If the service ever crashes, Windows restarts it after 10 seconds.
- Closing the JewelleryApp window does **not** stop the database.

To check it or start it by hand: press **Win + R**, type `services.msc`, find **JewelleryApp Database**, then click **Start** or **Restart**.

From an *administrator* Command Prompt in `C:\Program Files\JewelleryApp`:

```
jewellery-server service status
jewellery-server service stop
jewellery-server service start
```

## Upgrading

Run the new `JewelleryApp-Setup-<version>.exe`. It:

- stops the service;
- replaces the programs;
- keeps the same data folder (remembered from the last install);
- starts the service again.

New versions update the database tables automatically. Take a backup first anyway (**Settings > Daily backup > Back up now**).

## Uninstalling

Use **Settings > Apps > JewelleryApp > Uninstall** (or the Start menu shortcut). This stops and removes the service and deletes the programs. The data folder and backups are **kept**. Delete them by hand only if you are sure.

## Using JewelleryApp from other computers or tablets in the shop

By default the database only accepts connections from the laptop itself (`127.0.0.1:8090`). To allow other devices on the shop Wi-Fi:

1. On the server laptop, edit `C:\Program Files\JewelleryApp\jewellery.json` as Administrator. Change `"httpAddr": "127.0.0.1:8090"` to `"httpAddr": "0.0.0.0:8090"`.
2. Restart the **JewelleryApp Database** service.
3. Allow the port through Windows Firewall, for **Private** networks only. From an administrator Command Prompt:
   `netsh advfirewall firewall add rule name="JewelleryApp" dir=in action=allow protocol=TCP localport=8090 profile=private`
4. Give the laptop a fixed IP address on the router (for example `192.168.1.50`).
5. On the other device, open `http://192.168.1.50:8090` in Chrome or Edge.

Only do this on the shop's own private Wi-Fi. Every user still needs their own login.

## Where things are

| What | Where |
|---|---|
| Programs | `C:\Program Files\JewelleryApp` |
| Settings file | `C:\Program Files\JewelleryApp\jewellery.json` |
| Database | `<data folder>\pb_data` |
| Daily backups (default) | `<data folder>\backups` |
| Log file | `<data folder>\logs\server.log` |
| Emergency database login | `<data folder>\pb_data\superuser-login.txt` (see the [Admin guide](ADMIN-GUIDE.html)) |
| App address | `http://127.0.0.1:8090` |

## Troubleshooting

| Problem | What to do |
|---|---|
| "Cannot reach the database" or "The JewelleryApp database is not running" | Open `services.msc` and start **JewelleryApp Database**. If it stops again, read `logs\server.log`. |
| Port 8090 is already used by another program | Change the port in `jewellery.json` (for example `127.0.0.1:8095`), then restart the service. |
| Forgot the admin password | See "Forgotten admin password" in the [Admin guide](ADMIN-GUIDE.html). |
| The window opens in a normal browser tab | Edge and Chrome were not found. Install either one, or keep using the tab. |
