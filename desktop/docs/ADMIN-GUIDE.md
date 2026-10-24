# Admin guide

## Roles

| Role | Can do |
|---|---|
| **Admin** (head office only) | Everything: settings, branding, users, branches, master data, backups, payment and WhatsApp keys, MySQL export |
| **Manager** | Billing, cancelling bills, customers, stock, purchases, vendors, reports, pawn, master data (items, stones, groups, payment modes). At head office: all branches and adding or transferring stock. |
| **Sales** | Billing, customers, stock view, pawn |

Head office (master branch) users can switch the branch shown in the top bar, including "All branches (consolidated)". Branch users see only their branch's stock, bills, customers, receipts and pawn loans. The **database server itself enforces this**, not only the screens. A branch user cannot read another branch's data, even with technical tools.

## Branches

**Branches & Access > Branches > Add.** Give each branch:

- a short **code**, used in document numbers, e.g. `PUN` gives `INV/PUN/2026-27/0001`;
- a name, address, phone and GSTIN (for branches in another state).

Only head office adds stock. It sends stock to branches with **Stock > Transfer to branch**, which prints a delivery challan.

## Users

**Branches & Access > Users** (or **Settings > Users & roles**):

- **Add:** username (letters, numbers, `.`, `_`, `-`), name, role, branch, and a starting password of at least 8 characters. Leave **Must change password at next sign in** ticked.
- **Reset a forgotten password:** edit the user, type a new password and tick **Must change password**.
- **Stop a user** (staff left): untick **Active**. Their name stays on old bills.
- Admin users must belong to the head office branch.
- Everyone can change their own password from the name menu at the top right.

Every sign in lasts 12 hours. Then the app asks for the password again.

## Forgotten admin password (no Admin can sign in)

The installer creates an emergency database account:

1. On the server laptop, open `<data folder>\pb_data\superuser-login.txt` (for example `C:\ProgramData\JewelleryApp\pb_data\superuser-login.txt`) as administrator. It contains an email and password.
2. Open `http://127.0.0.1:8090/_/` in a browser on that laptop and sign in with them.
3. Open the **staff** collection, then the `admin` record. Set a new password (enter it twice) and tick **mustChangePassword**. Save.
4. Sign in to JewelleryApp with the new password.

This page gives full access to the database. Do not share the file, and do not edit other collections there.

## WhatsApp

**WhatsApp > Setup** (head office Admin):

- **Click-to-chat (default, free, no setup):** the app opens WhatsApp (desktop or web) with the message typed in. You press Send for each message.
- **WhatsApp Cloud API (automatic sending):**
  1. Create a Meta Business account and a WhatsApp Business app at developers.facebook.com, and add your shop's number.
  2. Create and get approval for message templates in WhatsApp Manager (birthday, anniversary, offers), using `{{1}}`, `{{2}}` ... for the customer name, shop name and other placeholders. Then, in **Master Data > Message Templates**, enter each approved template's name (e.g. `birthday_wish`) and language code in **Approved Meta template name**.
  3. In **WhatsApp > Setup**, enter the **Phone number ID**, the **API version** (e.g. `v21.0`) and a **permanent access token** (System User token). Save.
  4. The token is stored only in the server's protected settings. The screen afterwards shows only its last characters. Use **Remove token** to delete it.
- **Birthday / anniversary:** set how many days before a birthday to send the wish (default 7). Pending wishes appear on the WhatsApp page each day.
- **Promotions:** choose customers (or vendors), a template, preview the list, then send. Contacts who have not opted in to WhatsApp messages (the tick box on the customer) are skipped. Tick it only with the customer's consent.

## Online payments (Razorpay)

1. Create a Razorpay account. In the Dashboard, go to **Account & Settings > API Keys** and generate keys. Start with **Test mode** keys (`rzp_test_...`).
2. In JewelleryApp, open **Settings > Razorpay keys**. Enter the **Key ID** and **Key Secret**, then click **Save keys**.
   - The secret is stored only on the server and is never sent to the screens again.
   - The server creates each payment order, checks Razorpay's signature on the result, and captures the payment. A payment counts as received only after that check.
3. Set **Settings > Payment gateway > Online payments** to **Razorpay**, then click **Save settings**.
4. On the billing screen and in **Customers > Receive payment**, use **Collect online**. Every attempt, including failures, is listed under **Online Payments**.
5. Test with Razorpay's test cards and UPI IDs. When ready, replace the keys with **Live mode** keys (`rzp_live_...`).

The laptop needs internet for online payments. **Test gateway (simulated)** lets staff practise the flow without Razorpay or real money. Refunds are made from the Razorpay Dashboard. Cancelling a bill that was paid online marks the payment "refund pending".

## Live gold and silver rates

**Today's Rates > Refresh live rates** fetches IBJA rates, with an international price plus import duty as a fallback. **Live rate settings** controls:

- the source;
- the duty %;
- a shop premium %;
- automatic refresh.

Always check the rates before saving. Bills use the latest **saved** rates.

## Activity log

**Settings > Recent activity** shows who created, changed or deleted records. Bills are never deleted, only cancelled. A cancelled bill puts its pieces back into stock.

## Security checklist

- Change the `admin123` password at the first sign in (forced).
- Give every staff member their own login. Don't share the admin login.
- Keep Windows updated and use a Windows password on the server laptop.
- Keep backups private: they contain all customer data and the payment / WhatsApp keys.
- Keep the database on `127.0.0.1` (this laptop only) unless you need other devices. In that case, follow the steps in [Installation](INSTALL.html) for the private shop network only.
