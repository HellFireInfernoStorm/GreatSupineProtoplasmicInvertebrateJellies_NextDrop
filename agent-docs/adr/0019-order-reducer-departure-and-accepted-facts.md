# ADR 0019: Trip departure takes planned orders out, and accepted held facts override the table

- Status: accepted
- Date: 2026-10-03
- Issue / PR: #28
- Designathon departure: no

## Context

Issue #28 implements `applyEvent` from [order-reducer.md](../spec/rules-core/order-reducer.md). Three points in the spec do not fit together:

- The catalogue derives out-for-delivery from `TRIP_DEPARTED` "per LOADED order". The monotonic rule's own example is a loader's offline `LOAD_CONFIRMED` arriving after the driver's `TRIP_DEPARTED`. In that case the order is still PLANNED when the trip departs. If it does not go out for delivery, the late load confirmation moves it to LOADED, and the driver's `STOP_OUTCOME` (LOADED -> DELIVERED) becomes an illegal transition.
- `CONFLICT_RESOLVED` with `ACCEPT_FACT` "applies the held event", but a held delivery fact usually sits on a stop that was cancelled or moved (`FACT_ON_CANCELLED_STOP`, `FACT_ON_REASSIGNED_STOP`). The table has no move from CANCELLED, or from PLANNED on another trip, to DELIVERED.
- The issue asks that an illegal transition come back as a typed result, but `api-surface.md` gives `applyEvent` a bare `OrderState` return.

## Decision

1. **Departure.** The transition table gains `PLANNED -> OUT_FOR_DELIVERY`, allowed only through the trip's departure (`TRIP_DEPARTED` or the derived `ORDER_OUT_FOR_DELIVERY`). Every order assigned to the departing trip that is PLANNED or LOADED goes out for delivery. A `LOAD_CONFIRMED` that arrives later is an earlier-stage fact: recorded, status kept.
2. **Accepted facts.** An accepted held fact applies even where the table has no move for it, because the dispatcher has confirmed that it happened. It still never regresses status.
3. **Typed result.** `applyEvent(state, event)` returns `{ state, outcome }`. The outcome kinds are:
   - `APPLIED`
   - `IGNORED_EARLIER_STAGE`
   - `ILLEGAL_TRANSITION`, with a reason
   - `SKIPPED_HELD`
   - `WAITING_FOR_REVERSAL`
   - `RESOLVED`
   - `NO_EFFECT`

   `reduceOrder(orderId, events, snapshot?)` folds a sequence.
4. **Plan decisions during a reversal.** A plan decision published for a LOADED order with a reversal pending (`ORDER_PLANNED` onto a new trip, or `ORDER_DEFERRED`) is kept on the order. `LOAD_REVERSED` then applies it, so the new trip is not lost while the goods are still on the truck.

## Alternatives considered

- Derive out-for-delivery only for LOADED orders and let sync hold the driver's facts: every offline loader would create conflicts for routine deliveries.
- Let the load confirmation regress the order to LOADED: breaks the monotonic rule.
- Make the dispatcher re-plan before accepting a fact: an extra step that changes nothing physical, and a delivered order would sit on a new trip.

## Consequences

- Spec edited: `spec/rules-core/order-reducer.md`, `spec/rules-core/api-surface.md`, `spec/events/catalogue.md`.
- Sync (#47, #54) reads the outcome to classify events. `ILLEGAL_TRANSITION` maps to the `ILLEGAL_TRANSITION` conflict.
