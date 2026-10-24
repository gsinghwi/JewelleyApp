# Installing JewelleryApp

## What you need

- A Windows 10 or 11 laptop (64-bit) with at least 4 GB RAM and 2 GB free disk space.
- A web browser: Google Chrome or Microsoft Edge (built into Windows). JewelleryApp is a **browser application**: the server laptop runs the database, and any laptop, tablet or phone on the same Wi-Fi opens it in a browser. Nothing is installed on the other devices.
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
   - opens port 8090 in Windows Firewall for **private** networks only, so other devices on the shop Wi-Fi can connect (public Wi-Fi stays blocked);
   - adds a **JewelleryApp** shortcut to the desktop and the Start menu.
6. Leave **Open JewelleryApp now** ticked and click **Finish**.

On first start the database creates its tables and loads the default master data (see [Master data setup](MASTER-DATA.html)). It also creates the user **admin / admin123**.

## First sign in

1. Open **JewelleryApp** from the desktop. It opens `http://localhost:8090` in your normal web browser. You can also type that address yourself, or bookmark it.
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

## Using JewelleryApp from other laptops, tablets or phones on the same Wi-Fi

This works straight after installing:

1. On the server laptop, sign in as Admin and open **Settings & Branding > Open on other laptops / tablets**. It shows the address to use, for example `http://192.168.1.50:8090`.
2. On the other device, connect to the **same Wi-Fi**, open Chrome or Edge, and type that address. Bookmark it, or use "Add to home screen" on a tablet or phone.
3. Sign in with that person's own username.

All devices work on the same data at the same time. A bill saved on one appears on the others within a second or two.

Things to get right once:

- **Wi-Fi set to Private on the server laptop.** Go to Windows **Settings > Network & internet > Wi-Fi > (your network) > Network profile type > Private**. The firewall rule only allows other devices on Private networks.
- **A fixed address.** Ask whoever manages the router to reserve an IP for the server laptop (DHCP reservation), so the address never changes. The laptop's name usually also works, e.g. `http://shop-laptop:8090`.
- **The server laptop must be on**, and not asleep, while others use the app. In Windows **Settings > System > Power**, set "When plugged in, put my device to sleep after" to **Never**.
- **Camera QR scanning** in the browser only works on the server laptop itself (`http://localhost:8090`). Browsers only allow the camera on secure (https) addresses. On other devices use **Scan from a photo** or a USB barcode / QR scanner, which types the tag into the scan box.

**To allow only the server laptop** (no other devices):

1. Edit `C:\Program Files\JewelleryApp\jewellery.json` as Administrator and change `"httpAddr": "0.0.0.0:8090"` to `"httpAddr": "127.0.0.1:8090"`.
2. Restart the **JewelleryApp Database** service.

The database admin pages (`/_/`) only open on the server laptop itself, never from other devices.

## Where things are

| What | Where |
|---|---|
| Programs | `C:\Program Files\JewelleryApp` |
| Settings file | `C:\Program Files\JewelleryApp\jewellery.json` |
| Database | `<data folder>\pb_data` |
| Daily backups (default) | `<data folder>\backups` |
| Log file | `<data folder>\logs\server.log` |
| Emergency database login | `<data folder>\pb_data\superuser-login.txt` (see the [Admin guide](ADMIN-GUIDE.html)) |
| App address | On the laptop `http://localhost:8090`; from other devices `http://<laptop IP>:8090` (shown in Settings) |

## Troubleshooting

| Problem | What to do |
|---|---|
| "Cannot reach the database" or "The JewelleryApp database is not running" | Open `services.msc` and start **JewelleryApp Database**. If it stops again, read `logs\server.log`. |
| Port 8090 is already used by another program | Change the port in `jewellery.json` (for example `0.0.0.0:8095`), then restart the service. Change the firewall rule "JewelleryApp" to the new port too. |
| Forgot the admin password | See "Forgotten admin password" in the [Admin guide](ADMIN-GUIDE.html). |
| Another laptop cannot open the address | Check that both devices are on the same Wi-Fi (not a guest network), the server laptop's network is **Private**, and the laptop is awake. Then try `http://<IP>:8090/api/jw/health`, which should show `{"ok":true,...}`. |
| The address changed | The router gave the laptop a new IP. Look it up again in Settings, and reserve the IP on the router. |
