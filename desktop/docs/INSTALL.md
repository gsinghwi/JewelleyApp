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
   - opens ports 8090 and 8443 in Windows Firewall for **private** networks only, so other devices on the shop Wi-Fi can connect (public Wi-Fi stays blocked);
   - creates the shop's HTTPS certificate and trusts it on this laptop;
   - limits the data folder to Windows and administrators, so other Windows users on the laptop cannot read the database, keys or backups;
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

Other devices use a **secure (https) connection**:

- passwords and customer data travel encrypted on the Wi-Fi;
- the camera can scan QR codes on every device.

The server laptop has its own small certificate authority, the "JewelleryApp Shop CA". The installer trusts it on the server laptop. Each other device trusts it **once**.

**Once per device:**

1. On the server laptop, sign in as Admin and open **Settings & Branding > Open on other laptops / tablets**. It shows:
   - the app address, e.g. `https://192.168.1.50:8443`;
   - the setup page, e.g. `http://192.168.1.50:8090/setup`;
   - the certificate fingerprint.
2. On the other device, connect to the **same Wi-Fi** and open the **setup page** address in the browser.
3. Tap **Download certificate**. Check that the fingerprint shown matches the one in Settings.
4. Install the certificate. The setup page has steps for Windows, Android, iPhone/iPad and Mac.
5. Open the app address (`https://...:8443`), bookmark it (or "Add to home screen"), and sign in with that person's own username.

All devices work on the same data at the same time. A bill saved on one appears on the others within a second or two. Typing the old `http://<IP>:8090` address on another device takes you to the secure address automatically.

Things to get right once:

- **Wi-Fi set to Private on the server laptop.** Go to Windows **Settings > Network & internet > Wi-Fi > (your network) > Network profile type > Private**. The firewall rule only allows other devices on Private networks.
- **A fixed address.** Ask whoever manages the router to reserve an IP for the server laptop (DHCP reservation). If the IP does change, the certificate is updated automatically within 5 minutes and devices keep working; only the address to type changes.
- **The server laptop must be on**, and not asleep, while others use the app. In Windows **Settings > System > Power**, set "When plugged in, put my device to sleep after" to **Never**.

**To allow only the server laptop** (no other devices):

1. Edit `C:\Program Files\JewelleryApp\jewellery.json` as Administrator. Set `"httpAddr": "127.0.0.1:8090"` and `"httpsAddr": "127.0.0.1:8443"`.
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
| Emergency database login | `<data folder>\superuser-login.txt` (see the [Admin guide](ADMIN-GUIDE.html)) |
| Key file for the stored Razorpay / WhatsApp keys | `<data folder>\keys\secrets.key` (not included in backups) |
| App address | On the laptop `http://localhost:8090`; from other devices `https://<laptop IP>:8443` (shown in Settings) |
| Device setup page | `http://<laptop IP>:8090/setup` |
| Shop certificate (HTTPS) | `<data folder>\tls\` (`ca.crt` is the certificate devices install) |

## Troubleshooting

| Problem | What to do |
|---|---|
| "Cannot reach the database" or "The JewelleryApp database is not running" | Open `services.msc` and start **JewelleryApp Database**. If it stops again, read `logs\server.log`. |
| Port 8090 or 8443 is already used by another program | Change `httpAddr` / `httpsAddr` in `jewellery.json` (for example `0.0.0.0:8095`), then restart the service. Change the firewall rule "JewelleryApp" to the new ports too. |
| A device shows "Your connection is not private" | The shop certificate is not installed on that device yet. Open `http://<IP>:8090/setup` on it and follow the steps. |
| Forgot the admin password | See "Forgotten admin password" in the [Admin guide](ADMIN-GUIDE.html). |
| Another laptop cannot open the address | Check that both devices are on the same Wi-Fi (not a guest network), the server laptop's network is **Private**, and the laptop is awake. Then try `http://<IP>:8090/setup`, which should show the setup page. |
| The address changed | The router gave the laptop a new IP. Look it up again in Settings, and reserve the IP on the router. |
