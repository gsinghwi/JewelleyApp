# Master data: what is loaded and what you must set up

When the database starts for the first time, it loads the default master data below. This happens only once. Your changes are never overwritten, even after an upgrade.

Sign in as `admin` and work through the **checklist** in order. Most of it is under **Settings & Branding** and **Master Data**, both visible only to head office Admin users.

## Checklist after installing

| # | Where | What to do | Required? |
|---|---|---|---|
| 1 | First sign in | Change the `admin123` password | Yes (forced) |
| 2 | Settings > Shop details | Shop address, phone, email, **GSTIN**, PAN, BIS hallmark licence no., **State** and **GST state code** | Yes, before the first bill |
| 3 | Settings > Branding | Logo, login background, colours, tagline | Optional |
| 4 | Settings > Billing & rates | Invoice / purchase / stock-tag prefixes, hallmark charge per piece, invoice terms | Check the defaults |
| 5 | Settings > Daily backup | Backup folder (USB, second drive or cloud-synced folder), time, how many to keep. Set a **backup password** (write it down, keep it away from the laptop), then click **Back up now** once. | Yes |
| 6 | Branches & Access | Rename "Head Office" to your shop's name and code, then add sub-branches if you have them | Yes |
| 7 | Branches & Access > Users | One login per staff member (Admin / Manager / Sales), each in a branch | Yes |
| 8 | Today's Rates | Click **Refresh live rates** (IBJA) or type today's rates, then **Save rates** | Yes, every day |
| 9 | Master Data > Items | Check making charges, wastage %, HSN and re-order levels for the items you sell. Add your own items. | Yes |
| 10 | Master Data > Stone types | Set your stone rates per carat / piece | If you sell studded items |
| 11 | Master Data > Payment modes | Add or switch off modes (e.g. your bank name for NEFT) | Optional |
| 12 | Master Data > Currencies | Enter today's value of each foreign currency in ₹, or switch off ones you don't use | Optional |
| 13 | Opening stock | Enter the pieces already in the shop (see below) | Yes |
| 14 | Customers / Vendors | Enter existing customers (with birthdays for WhatsApp wishes) and suppliers | As needed |
| 15 | WhatsApp > Setup | Choose "Click-to-chat" (no setup) or enter the WhatsApp Cloud API keys | Optional |
| 16 | Settings > Payment gateway / Razorpay keys | Enter the Razorpay Key ID and Key Secret, then switch on Razorpay | Optional |
| 17 | Pawn / Girvi > Pawn settings | LTV %, interest %, method, tenure, licence no., ticket terms | If you do pawn broking |

## Default master data loaded by the installer

### Branches

| Code | Name | Type |
|---|---|---|
| HO | Head Office | MASTER |

There is always exactly one MASTER branch. Its users can see every branch, add stock, buy from vendors and manage users. Rename it; do not delete it.

### User

| Username | Password | Role | Branch |
|---|---|---|---|
| admin | admin123 (must be changed at first sign in) | Admin | Head Office |

### Currencies

| Code | Name | Symbol | Value in ₹ |
|---|---|---|---|
| INR | Indian Rupee | ₹ | 1 (base currency, cannot be deleted) |
| USD | US Dollar | $ | not set |
| AED | UAE Dirham | AED | not set |
| EUR | Euro | € | not set |
| GBP | British Pound | £ | not set |
| SGD | Singapore Dollar | S$ | not set |

Bills are always in ₹. The other currencies are for reference and conversion, for example tourists paying in dollars. Enter their value in ₹ under **Master Data > Currencies** when you need them.

### Metals and purities (karat)

| Metal | Purities |
|---|---|
| Gold | 24K (999), 22K (916), 20K (833), 18K (750), 14K (585) |
| Silver | Fine Silver (999), Sterling Silver (925) |
| Platinum | Platinum (950) |
| Not applicable | for loose stones |

Rates are entered per gram for each purity on **Today's Rates**. **Auto-fill from 24K & Fine Silver** works out the others from fineness.

### HSN codes and GST

| HSN | Description | GST |
|---|---|---|
| 7113 | Jewellery of precious metal | 3% |
| 7114 | Articles of goldsmiths' / silversmiths' wares | 3% |
| 7118 | Coins | 3% |
| 7108 | Gold (bars, unwrought) | 3% |
| 7106 | Silver (bars, unwrought) | 3% |
| 7110 | Platinum | 3% |
| 7102 | Diamonds (loose) | 0.25% |
| 7103 | Precious and semi-precious stones | 3% |
| 7117 | Imitation jewellery | 3% |

Making charges are billed with the item at the same rate. Check these with your CA, and edit them under **Master Data > HSN & GST** if the law changes.

### Categories (9) and items (113)

| Category | Items | Examples |
|---|---|---|
| Gold Jewellery | 41 | Ladies / gents ring, chains, necklace, choker, haar, mangalsutra, bangles, kada, earrings, jhumka, nose pin, anklets, pendant |
| Temple Jewellery | 6 | Temple necklace, kasu mala, temple jhumka, oddiyanam, vanki, nethi chutti |
| Kundan & Polki | 6 | Kundan necklace set, polki necklace, jadau earrings, kundan bangles |
| Diamond Jewellery | 10 | Diamond ring, solitaire, earrings, pendant, bangles |
| Platinum Jewellery | 6 | Platinum ring, couple bands, chain, bracelet |
| Silver Jewellery | 10 | Payal, bichhiya, silver kada, chain, oxidised necklace |
| Silver Articles | 12 | Glass, thali, katori, pooja thali set, diya, idol, photo frame |
| Bullion & Coins | 11 | Gold coins 1 g to 10 g and sovereign, gold bars 50 / 100 g, silver coins, 1 kg silver bar |
| Gemstones | 11 | Manik, panna, pukhraj, neelam, moti, opal, navratna set, certified loose diamond |

Each item has:

- a default purity and an HSN code;
- a pricing method: by weight (metal rate × net weight + making + wastage + stones) or fixed price / MRP;
- a making-charge type and value: % of metal value, ₹ per gram, or ₹ per piece;
- a wastage % and a re-order level.

These are typical values, not your shop's. Review them before billing.

### Stone types (16)

| Kind | Stones and default rates |
|---|---|
| Diamonds | VVS-EF ₹95,000/ct, VS-GH ₹65,000/ct, SI-IJ ₹42,000/ct, Solitaire ₹1,50,000/ct |
| Precious stones | Ruby (Manik), Emerald (Panna), Yellow Sapphire (Pukhraj), Blue Sapphire (Neelam) |
| Other stones | Pearl, Red Coral, Hessonite, Cat's Eye |
| Uncut | Polki |
| Per-piece stones | Kundan, CZ / American Diamond, Meenakari |

Change the rates to your own.

### Payment modes (7)

Cash, UPI, Credit Card, Debit Card, NEFT / RTGS / IMPS, Cheque, Gold Scheme / Advance.

### Customer groups (4)

Retail, VIP, Wholesale, Gold Saving Scheme. Each group has a discount % on making charges (VIP 5% by default), applied automatically on the bill.

### Customers

**Walk-in Customer** (code C0000), for cash bills without customer details. Bills on credit, and bills of ₹2 lakh or more (PAN required), need a named customer.

### WhatsApp message templates (5)

| Template | Type |
|---|---|
| Birthday wish | Birthday (sent 7 days before) |
| Anniversary wish | Anniversary |
| Festive offer (Dhanteras / Diwali) | Promotion |
| New collection launch | Promotion |
| Supplier announcement | Promotion (vendors) |

### Settings defaults

| Setting | Default |
|---|---|
| Shop name | Nisarg Jewellers |
| State / GST state code | Maharashtra / 27. Change both if your shop is elsewhere. |
| Prefixes | Invoice `INV`, purchase `PUR`, stock tag `T`, pawn `PWN` |
| Hallmark charge | ₹45 per piece |
| Live rates | IBJA (India Bullion and Jewellers Association), with an international-price fallback. Import duty 15%. |
| Online payments | Off |
| WhatsApp | Click-to-chat (opens WhatsApp with the message typed in) |
| Pawn | LTV 75%, interest 1.5% per month, minimum 1 month, tenure 12 months |
| Daily backup | 21:00, keep the last 30, folder `<data folder>\backups` |

## Document numbers

The database assigns all numbers, so two counters can never get the same one:

| Document | Format | Example |
|---|---|---|
| Invoice | `<prefix>/<branch code>/<financial year>/<serial>` | `INV/HO/2026-27/0001` |
| Receipt | `RCT/<branch>/<FY>/<serial>` | `RCT/HO/2026-27/0001` |
| Pawn ticket | `<pawn prefix>/<branch>/<FY>/<serial>` | `PWN/HO/2026-27/0001` |
| Purchase | `<prefix>/HO/<FY>/<serial>` | `PUR/HO/2026-27/0001` |
| Stock transfer | `TRF/<from branch>/<FY>/<serial>` | `TRF/HO/2026-27/0001` |
| Stock tag | `<tag prefix><number>`, starting at 1001 | `T1001` |
| Customer code | `C<number>` | `C0001` |

Serials restart each financial year (April to March) for each branch. You can type your own stock tag (for example an existing barcode). Duplicate tags are refused.

## Entering opening stock

The fastest way to enter the pieces already in the shop:

1. **Vendors**: add a vendor called `Opening Stock`.
2. **Purchases > New purchase**: choose that vendor, today's date and paid = total. Add one row per piece: item, purity, gross and net weight, stone weight and value, HUID and cost.
3. Save. Each piece gets a stock tag, goes into **Stock** at the head office, and you are offered QR stickers to print.
4. Send pieces to branches with **Stock > Transfer to branch**.

To keep a piece's existing tag number, use **Stock > + Add piece** and type the tag.
