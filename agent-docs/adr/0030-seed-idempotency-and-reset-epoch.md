# ADR 0030: Seed idempotency, the reset epoch and seeded story state

- Status: accepted
- Date: 2026-10-03
- Issue / PR: #30
- Designathon departure: no

The reset-epoch rule, Nimal's depot and the hill-trip re-pick were decided by Dinura on 2026-10-03 in the working session for #30 (recorded on the issue).

## Context

[ADR 0007](0007-demo-reset-epoch.md) says `DemoState.resetEpoch` increments on every reset and seed, and that a client whose epoch differs clears its outbox. Issue #30 asks that the seed run on every start with `SEED_ON_START=true` and that running it twice change nothing. Read together, every API restart would bump the epoch, and field devices would discard unsynced deliveries.

[seed-and-demo.md](../spec/data/seed-and-demo.md) also leaves open:
- what "idempotent" means for rows the demo has since changed;
- who placed the seeded orders;
- how much of the story (shortfall, dispute, clash) is seeded;
- the walkthrough's store and loader names.

The Booklet counts trip time per order (`inter_stop × (n_orders − 1)` plus handling per order). The hill trip pinned in ADR 0027 (5 stops, 266 of 270 minutes) therefore had no room for the hill store's second order, which walkthrough step 13 needs.

## Decision

- **Reset epoch.** The seed increments `resetEpoch` only when it wrote something: it created the `DemoState` row (epoch 1), or it created or updated any other row. A re-run that finds everything in place writes nothing. `/demo/reset` always increments the epoch. This amends ADR 0007.
- **What a re-run writes.** Reference data, products, accounts, drivers and weekly demand history are compared with the seed by natural key and updated where they differ. Operational rows are created only when missing and never rewritten: orders with their lines and events, vehicle availability, outlet service state and `DemoState`. A restart therefore never reverts demo progress. Restoring a known state is `/demo/reset`'s job.
- **Who placed the orders.** An order is placed by its outlet's own store account where one is seeded. Otherwise the dispatcher keyed it in (orders phoned in). Prior-day deferrals are `ORDER_DEFERRED` events by the dispatcher. No synthetic system user is created.
- **Prior-day deferral state** lives in order status, `deferredCount`, the `ORDER_DEFERRED` events and `OutletServiceState`. No `Deferral` rows are seeded, because they belong to a published plan version.
- **Seeded story state.** The seed stops at the start of the story: orders placed, `ORD10412` carried over from the previous run. The loader shortfall, the offline deliveries, the clash and the dispute need published plans, so the demo presets (#38) reach them.
- **Accounts.**
  - Nimal's `User.depot` is null (every depot), so the depot selector can switch to Kandy.
  - The extra accounts are the Kandy loader `LDR002` (Pradeep) and the hill-store manager (Ishara), whose login is the hill store's outlet ID.
  - Demo credentials are one password for store and dispatcher accounts and one PIN for loader and driver accounts, listed in the README.
  - A stored argon2 hash is kept while it still verifies the demo secret, because argon2 salts every hash.
- **Dilini's outlet gets no bulk order.** Dilini places that outlet's dry and chilled orders live in walkthrough step 1.
- **Hill trip re-pick** (amends ADR 0027). The trip carries a chilled order at every stop and a dry order at the store stop. The picker therefore takes 4 outlets (5 orders): `OUT105 → OUT104 → OUT106 → OUT107` on `VEH039`, with `OUT104` as the hill store.
- **Peak-day calibration.** Thirteen Peliyagoda vehicles are in the workshop, among them four reefer trucks, a reefer van, an ambient van and one breakdown. With them, `proposePlan` serves 80 of the 86 bulk orders and defers 6, mostly for want of a reefer. `calendar.csv` ends in June 2026, so the story date carries no festival ramp.

## Alternatives considered

- Always increment the epoch on seed (ADR 0007 as written): every restart would wipe field outboxes.
- Never increment it in the seed: a reseeded database with new data would leave clients holding stale orders.
- Rewrite operational rows on every run: a restart would undo the judges' progress.
- Keep the 5-stop trip and serve the store's second order elsewhere: step 13 would no longer happen at one store on one delivery.

## Consequences

The seed is safe to run on every start. Changing seeded reference data or the catalogue takes effect on the next start and bumps the epoch, but a changed order generator does not touch existing orders: use `/demo/reset` or a fresh database. Spec edited: `data/seed-and-demo.md` (§15.1, §15.2, §15.3, §15.5). ADR 0007 and ADR 0027 carry a pointer to this ADR. Design doc edited: `design/mock-story.md`.
