---
status: draft
owner: Dinura
sources: architecture review of the draft guide
---

# Open questions

Unsettled decisions found when reviewing the draft architecture guide against the Booklet and the design context. When one is settled: remove it here, add an ADR, edit the spec file named in its entry (see [spec-changes.md](../process/spec-changes.md)).

## Decisions needed

### Q1. Window handling for the second Fresh trip

`WINDOW_MISSED` is hard ([constraints.md](domain/constraints.md)) and trip-2 departure includes the return leg and a reload buffer ([trip-time-and-budgets.md](domain/trip-time-and-budgets.md)). The Booklet's 270-minute Fresh budget excludes the return leg. The validator can therefore reject double-Fresh runs the organisers' checker accepts, which defers orders that were feasible.
Options: keep it hard and document it; make post-08:00 arrival on trip 2 a `LATE_RISK` warning; exclude the return leg from validation ETAs and keep it only for displayed ETAs.

### Q2. Demo isolation on the shared public deployment

`/demo/reset`, the demo clock and the presets mutate one global database that several judges may use at once ([seed-and-demo.md](data/seed-and-demo.md)). One judge's reset or clock change breaks another's walkthrough, and offline devices keep outboxes for pre-reset state.
Options: a `resetEpoch` in the snapshot and in events so clients wipe stale outboxes; scope the clock and orders to a workspace key; at minimum a fast reset and a visible "last reset by" banner.

### Q3. Order changed after loading

The transition table has no `LOADED → PLANNED | DEFERRED | CANCELLED` ([order-reducer.md](rules-core/order-reducer.md)), yet the design's loader "plan changed" banner implies republishing after loading. An offline `LOAD_CONFIRMED` for an order a later plan version removed is classified `APPLIED` and then hits an illegal transition. For a physical fact (goods are on the truck) this must be a conflict, not a silent rejection.
Decide the path and add a conflict kind in [recovery-and-conflicts.md](sync/recovery-and-conflicts.md).

### Q4. Resolution of a shortfall at the dock

`LOAD_SHORT` notifies the dispatcher and store, and `TRIP_READY` requires all orders "resolved" ([catalogue.md](events/catalogue.md)), but nothing says who resolves a short or how (ship partial, hold the trip, back-order). The design story ships partial and notifies. Make it a first-class decision with its own event.

### Q5. Scope of the weekly fuel lock

The publish lock is per planning day ([publish-transaction.md](planning/publish-transaction.md)) but the quota invariant is per vehicle per ISO week. Republishing an earlier day after a later one is published can exceed the quota unchecked. Lock on `(depot, ISO week)` or re-validate later days when republishing.

### Q6. Real IDs for the story fixtures

The design uses placeholder IDs. The seed uses real `outlets.csv` and `vehicles.csv`, but [seed-and-demo.md](data/seed-and-demo.md) assumes `OUT015` is a Fresh outlet in Wellawatte served from Peliyagoda and that `VEH001` is a reefer. Pick real IDs with the right attributes before writing fixtures.

## Smaller review notes

- Priority policy is strictly lexicographic ([priority-policy.md](domain/priority-policy.md)). A large Style order deferred yesterday outranks all chilled Fresh orders and uses trip slots. "Can move a day with least impact" has no computable definition.
- Deferral records have cause and reason but no consequence (days unserved after the deferral, next serviceable date). The Booklet asks dispatchers to explain consequences.
- The allocator packs trips and then assigns vehicles ([allocator.md](rules-core/allocator.md)). Claim "maximal" only for single-order insertions.
- One order is one stop, which matches the checker, but a Fresh outlet with dry and chilled orders appears as two stops at one door. Group by outlet in the driver and store UX and keep accounting per order.
- Brand ordering rules (Style weekly day, Fresh chilled days, Tech single items) are not modelled. Decide whether the store order screen enforces them or they only shape the seed.
- The capacity outlook compares forecast m³ with capacity. Define capacity in m³; the design shows tonnes.
- Timeline order uses device capture time plus a clock offset. Order within a device by `deviceSeq`; use offsets for display only.
- District travel and service allowance tables are needed for trip time but sit under the Datathon reference files, not the Hackathon's three shared files. Confirm with the organisers that seeding them is allowed ([data-policy.md](platform/data-policy.md)); keep a fallback.
- The `FeedCounter` row serializes all writing transactions. Acceptable at this scale.
- Prisma with many hand-written SQL objects: confirm early that `migrate dev` and `migrate deploy` do not report drift or drop them.
