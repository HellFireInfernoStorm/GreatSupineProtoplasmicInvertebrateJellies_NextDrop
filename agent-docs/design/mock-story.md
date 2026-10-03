---
status: draft
owner: Dinura
sources: design context §5
---

# Shared mock story

Keep these consistent. Any number change must cascade through both fidelities.

**Cast and fixtures**
- Store manager **Dilini**, outlet **OUT015**, Waypoint Fresh, Wellawatte.
- Dispatcher **Nimal**, Peliyagoda DC. Loader **Kasun** (Peliyagoda Dock 3). In Figma, Driver **Ruwan S.** carries the Store, Dispatcher and Loader story (VEH001, trip T001), while **Sampath** (Kandy hub, reefer) carries the Driver screens and the Kandy-hill degradation narrative.
- **Build:** Sampath on a Kandy fixture is the walkthrough driver, and Ruwan S. is an extra account. Real IDs from the CSVs replace the placeholders below (ADR 0008, ADR 0027): `OUT015` → `OUT004` (Colombo), `VEH001` → `VEH039` (Kandy reefer truck, driver `DRV039`), `T001` → `VEH039`'s Fresh trip 1 to Nuwara Eliya, whose store at stop 2 is `OUT104` with ORD10412 and ORD10468 (ADR 0030). The module `apps/api/prisma/seed/story-fixtures.ts` holds them.
- Date of the "day": **Tue 29 Sep 2026**. Planning happens Mon 28 Sep evening.

**ORD10412 (chilled, Dilini)**: 12 milk + 8 eggs = 20 crates ordered Sun 27 Sep 14:05. Deferred Sun 21:40 (reefer capacity full) → Tue 29 Sep. Planned Mon 20:15 on T001 · VEH001, ETA 06:00–06:30. Loader Kasun flags **4 × milk short at the dock** 02:52. Loaded 16 crates 03:24. Out for delivery 03:30 (left Peliyagoda DC). **Delivered 06:12** (16 crates, signed, 1 photo, driver's phone). **Confirmed 07:40 after sync**. Receipt confirmed 07:44. 07:46 Dilini disputes 1 warm crate with a photo → goes to the dispatcher.

**Other orders**: ORD10468 dry, 18 cases, delivered in full, received 07:44. Orders placed 13:14 on Tue: ORD10475 (dry) and ORD10476 (chilled) for Wed 30 Sep. **ORD10475 deferred to Thu 1 Oct** at 21:05 (capacity shortfall) with a push notice.

**Dispatcher plan (Tue 29 Sep planning)**: 86 orders; at 20:15 (Dashboard, D2) 81 planned on 14 trips / 9 vehicles with 5 unassigned. At 20:40 the D2 add-trip modal rescues **ORD10462 + ORD10441 onto T015** (VEH008 trip 2 of 2, Tech · Gampaha), and the blocked modal defers **ORD10457** (Style order on a Tech trip). So **D3 (21:02)** has 3 deferrals, 15 trips, 83 store ETAs, and D4 shows 6 second trips later. Fleet 61.2 t/day, reefer 25.3 t.

**D4 live runs (Tue 29 Sep 07:50)**: T002 grey card "T002 · VEH004 · Gampaha · Fresh · No signal · Last sync 07:22 · stop 3 of 5 · low-coverage area near Minuwangoda" (not escalated); T001 synced 07:40 with 4 stops recorded offline; T003 late risk 41%; T008/T007 also shown. Exceptions inbox: Dispute ORD10412 (07:46), Failed stop T003 OUT027 (06:58), Damaged ORD10453 OUT007 (02:50), Short ORD10412 (02:52, seen), Ack T001 (02:33). Dispute detail shows the store photo 07:45 next to the driver's proof-of-delivery 06:12, with actions Credit / Add to Wed run (toast "ORD10412 added to next run") / Reject with note.

---
