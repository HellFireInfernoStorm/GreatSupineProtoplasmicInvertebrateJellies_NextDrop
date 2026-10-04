# ADR 0053: Later-stop edits after departure

- Status: proposed
- Date: 2026-10-04
- Issue / PR: #145, #159, #160
- Designathon departure: no

## Context

ADR 0037 froze all departed stops, preventing walkthrough step 10 and the removed-stop clash in ADR 0040. Departure is not evidence that every later stop has been visited.

## Decision

This amends ADR 0037's locked-stop rule. A stop is locked when an applied or accepted-held STOP_ARRIVED, STOP_OUTCOME or POD_CAPTURED is in effect, its trip is COMPLETE, or its LOADED order is pinned without a pending reversal (ADR 0004). Locked stops keep vehicle and trip number, and keep relative order among locked stops on that trip. Removing or moving earlier unlocked stops may compact their numeric sequence. COMPLETE trips cannot change.

On a DEPARTED trip, unreported stops may be removed/deferred or resequenced after every locked stop. They cannot move to another vehicle or trip. New cargo cannot be added to a departed trip. Publish rejects illegal edits atomically with 409 STOP_LOCKED. LOADED-order reversal checks remain authoritative.

Planning reads include all current published stops even when their orders have progressed beyond the allocatable queue. The canonical planning context includes each stop's placement, locked and departed flags. Validation accepts those orders only on their existing trip; it does not make delivered orders allocatable. Propose is refused once any trip has departed; the dispatcher edits the retained draft instead.

A same-trip ORDER_PLANNED updates an OUT_FOR_DELIVERY order's assignment without regressing status, followed by PLAN_CHANGED. ORDER_DEFERRED may move an unreported OUT_FOR_DELIVERY order to DEFERRED and clear its assignment; publish's fact lock protects reported stops. Finished orders never regress on republish. This is an explicit amendment to the reducer transition table in ADR 0019, required for replay to agree with persisted state.

Explicit dispatcher draft order is preserved by schedules and both validators only for a trip with a departed published stop on the same vehicle and trip number. Other dispatcher trips and allocator proposals retain default window ordering: earliest window close, then district order, then order ID. This makes departed same-trip resequencing persist without making an undeparted draft's insertion order authoritative. Lock comparisons use this sequenced delivery order, matching persisted stop seq, rather than raw draft indices; loading an undeparted hand-ordered trip must not prevent an unchanged republish.

The board displays locked stops and disables their move control. Unreported stops retain the existing Move to menu (ADR 0002): their own trip resequences to the end, Unassigned removes them for D3's reason review. Invalid destinations are omitted. Offline facts for removed stops still use ADR 0040 classification and remain HELD_CONFLICT / FACT_ON_CANCELLED_STOP.

## Alternatives considered

- Keep every departed stop frozen: prevents the required live plan change and conflict walkthrough.
- Allow arbitrary moves after departure: contradicts physical cargo and already recorded field facts.
- Treat progressed orders as generally plannable: allows delivered orders to be allocated again.

## Consequences

Additive planningContext contract field; contract-change label required. No schema migration. Spec updates cover planning flow, publish locks, planning context and reducer transitions. Integration coverage exercises real departure, reported outcome, later-stop removal/resequence and offline clash.

