---
status: draft
owner: Dinura
sources: design context §2, §6
---

# Screen inventory and per-app walkthrough

Fourteen core screens plus the degradation scenario. IDs below are the Blueprint's.

| ID | Role | Screen | Device | Status in Figma |
|---|---|---|---|---|
| S1 | Store | Place order (dry vs chilled, cutoff countdown, repeat last week, confirmation ID) | Phone + desktop | Hi-fi both, low-fi both |
| S2 | Store | My deliveries (ETA window, deferral notice, out for delivery) | Phone + desktop | Hi-fi both, low-fi both |
| S3 | Store | Confirm receipt (pre-filled from driver record; report short/damaged/warm) | Phone (+ desktop dialog) | Hi-fi both, low-fi phone |
| D1 | Dispatcher | Order queue | Desktop | Hi-fi + low-fi |
| D2 | Dispatcher | Plan board | Desktop | Hi-fi + low-fi, plus add-trip modal and constraint-breach modal |
| D3 | Dispatcher | Deferral review and publish | Desktop | Hi-fi + low-fi |
| D4 | Dispatcher | Live run monitor | Desktop | Hi-fi + low-fi |
| D5 | Dispatcher | Capacity outlook | Desktop | Hi-fi + low-fi |
| L1 | Loader | Dock trips | Tablet | Hi-fi, 6 states |
| L2 | Loader | Load checklist | Tablet | Hi-fi, 11 states |
| L3 | Loader | Mark ready | Tablet | Hi-fi, 3 states |
| R1 | Driver | Today's run | Phone | Hi-fi + low-fi |
| R2 | Driver | Stop and proof of delivery | Phone | Hi-fi + low-fi |
| R3 | Driver | Sync and conflicts (degradation screen) | Phone | Hi-fi + low-fi |

Extras we added beyond the 14: a **D0 Dispatcher Dashboard**, a **Fleet & capacity** screen (supports D2/D5), **login screens for every app** (S0/D0/L0/R0), **degradation flows** for Driver and Store, and a **Style Guide** page.

---

## 6.1 Store Manager (S0–S3)

Desktop is a sidebar app (Sidebar 240 wide, TopBar with bell). Phone uses a dark app bar, a bottom PhoneNav (My deliveries · Place order · Receipt · History) and cards.
- **S2 My deliveries**: hero card "Arriving today · 6:00–6:30 AM · Trip T001 · VEH001 reefer · you are stop 4 of 7", progress bar, "Stop 3 of 7 delivered · updated 05:48", Timeline and Details buttons, an amber "Expect partial delivery · chilled" alert (16 of 20 crates, 4 × milk short at the dock, Loader 02:52), Today's orders list (ORD10412 short 4, ORD10468 on the way), Next order card ("Wed 30 Sep order closes in 10 h 10 min", Order button).
- **S3 Confirm receipt** (07:44): pre-filled from the driver's record ("Delivered 06:12 on the driver's phone · Confirmed 07:40 after sync — the driver was offline on the run", Ruwan S. · VEH001 · Trip T001, signed by Dilini · 1 delivery photo), per-item steppers (milk ordered 12 delivered 8, eggs ordered 8 delivered 8), the amber short note, "Received as delivered" and "Report an issue".
- **S3 Report an issue** (07:46): warm chilled crate with photo.
- **S1 Place order** (13:12 phone) → Add items → Review & submit → Order placed (13:14, confirmation IDs ORD10475 dry and ORD10476 chilled). Desktop has product pages for Fresh, Style and Tech.
- **Order tracking / Order timeline / Order history / Order detail**: timeline events Ordered → Deferred → Planned → Short → Loaded → Out for delivery → Delivered (with "confirmed 07:40 after sync") → Disputed.
- **Notifications**: desktop popover and phone panel with unread dots, all-read state; deferral push banner on My deliveries at 21:10.

## 6.2 Dispatcher (D0–D5)

- **D0 Dashboard**, **D1 Order queue** (confirmed orders after cutoff with flags and a demand vs capacity summary), **D2 Plan board** (vehicle × trip columns, capacity bars for weight/volume/time/fuel, late-risk badges, "+ Add trip" button opening the T015 modal; the constraint-breach modal blocks with a reason and disables Create), **D3 Deferral review & publish** (every unassigned order needs a reason code, outlets skipped yesterday pinned, publish notifies loader/driver/store), **D4 Live runs** (trip progress, last-sync time per vehicle, late-risk badges, exceptions inbox), **D5 Capacity outlook** (single-series chart with capacity reference line and a table twin), **Fleet & capacity**.
- Sidebar items: Dashboard, Order queue, Plan board, Defer & publish, Delivery Progress, Capacity outlook, Fleet & capacity, Settings.

## 6.3 Loader (L1–L3)

Landscape 1280×800, dark, 64 px+ targets. L1 lists trips leaving the dock by departure time with status; a **plan-changed banner** opens a **review sheet** to accept. L2 lists orders in **reverse stop order** (last stop loaded first) with Loaded / Damaged / Short per row; Short and Damaged open sheets (quantity, reason chips, photo); toast confirms with Undo. L3 summarises loaded/short, blocks handing over until everything is checked, and uses a **hold-to-mark-ready** button. Sinhala and Tamil versions of L2 exist and are flagged **"needs native check"**.

## 6.4 Driver (R1–R3)

360×800 dark. R1 Today's run (stop list, "Open in Google Maps", sync pill always visible); R2 one-stop-per-screen: Arriving → outcome (Delivered in full / Partial / Refused) → proof (receiver name + signature or photo) → Saved on this phone; R3 Reconnecting (progress) → Conflict (side by side) → All synced. Flag-a-problem sheet at the store. Details in §7.

---
