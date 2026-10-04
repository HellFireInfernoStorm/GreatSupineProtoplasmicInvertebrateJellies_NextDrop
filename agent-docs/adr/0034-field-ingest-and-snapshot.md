# ADR 0034: Field ingest, trip facts and the field snapshot

- Status: proposed
- Date: 2026-10-04
- Issue / PR: #47
- Designathon departure: no

## Context

Issue #47 implements the [push protocol](../spec/sync/push-protocol.md), the field snapshot of the [change feed](../spec/sync/change-feed.md) and the device heartbeat. Several details were open:
- which error code each refusal returns
- how an event "depends" on a rejected one
- how trip facts move the trip
- which line quantities a fact updates
- where the snapshot's reason lists come from

Conflict classification is a later issue (#54).

## Decision

1. **Device binding.** A push batch and a heartbeat must name the session's own device (FIELD sessions are bound to one deviceId, ADR 0024), otherwise 403.
2. **Per-event checks**, in order:
   - **Actor and author.** The declared actor must be the caller, and the type must be one the caller's role authors (event catalogue), otherwise `FORBIDDEN`.
   - **Duplicate.** A known `clientEventId` returns `DUPLICATE` with its server id. If the id belongs to another user, the result is `FORBIDDEN`.
   - **Dependency.** A later event in the batch about an order, trip or vehicle already rejected in that batch returns `ILLEGAL_TRANSITION`.
   - **Sequence.** A reused `(deviceId, deviceSeq)` under a new id returns `REJECTED DUPLICATE`.
   - **Subjects.** A missing subject returns `NOT_FOUND`. A loader outside its depot returns `FORBIDDEN`. A driver not assigned the order, trip or vehicle returns `NOT_ASSIGNED`, as does a stop or load fact on an order that has no trip.
   - **Lines.** Line ids that are not the order's return `SCHEMA_INVALID`.
3. **Writes.** Each accepted event runs in its own short transaction:
   - a compare-and-set on the order (or trip) status, where the issue says "lock the order row"; this avoids raw `FOR UPDATE` against an unqualified schema
   - the event, inserted with `createMany({ skipDuplicates: true })`
   - line projections and notifications
   - feed rows, last

   A lost race retries the event (up to 3 times). Any other server error fails the request with 5xx, so the client retries the batch; replays are idempotent.
4. **Illegal transitions.** Until #54 classifies conflicts, a fact the reducer calls `ILLEGAL_TRANSITION` is rejected. A late earlier-stage fact is accepted and recorded without moving the status.
5. **Trip facts.**
   - `TRIP_READY` moves PLANNED to READY. It is refused while `rules.tripChecklistReadiness` is not ready: every ordered line on every stop must be checked (`qtyLoaded + ΣqtyShort + ΣqtyDamaged >= qtyOrdered`), and no order may have a short line that is unresolved or resolved `HOLD_TRIP` (ADRs 0005, 0047).
   - `TRIP_DEPARTED` moves PLANNED or READY to DEPARTED. In the same transaction it derives a server `ORDER_OUT_FOR_DELIVERY` for each order `rules.ordersGoingOut` returns (ADR 0019). The derived event's actor is the driver.
   - A repeated or late trip fact is recorded without moving the trip. A cancelled trip refuses both.
6. **Projections.**
   - `LOAD_CONFIRMED` sets `qtyLoaded`.
   - `LOAD_REVERSED` resets every line's `qtyLoaded` to 0 (ADR 0047).
   - `STOP_OUTCOME` sets `qtyDelivered` from its lines; a FULL outcome without lines delivers what was loaded (or ordered).
   - A delivering outcome sets `Order.confirmedAt` to the server's receipt time ("confirmed after sync", ADR 0032).
   - Accepted batches and heartbeats update the device's `lastSeenAt` (last heard). Heartbeats append no feed rows.
7. **Notifications and feed rows.**

   | Event | Notification |
   | --- | --- |
   | `LOAD_SHORT` | dispatchers of the depot, and the store |
   | `LOAD_DAMAGED` | dispatchers |
   | Delivering `STOP_OUTCOME` | the store (`delivered`) |
   | Failed or refused `STOP_OUTCOME` | dispatchers (`stop_failed`) |
   | `PROBLEM_FLAGGED` | dispatchers |

   Order facts append `order_changed`. Trip facts and acknowledgements append `run_updated` for the depot and vehicle.
8. **Snapshot.**
   - The date comes from the query.
   - `planVersion` is the actor depot's planning day version (null before publication).
   - The loader's `reversals` are LOADED orders with a pending reversal.
   - Reason lists:
     - deferral and problem codes come from rules and contracts
     - the load-short, load-damaged and stop-outcome codes are the build's own (the design draws the chips without listing them), each with the i18n key `<list>.<code>` (load-damaged catalogue in ADR 0042)

## Alternatives considered

- **`SELECT … FOR UPDATE` on the order row**: needs schema-qualified raw SQL. The compare-and-set gives the same single-writer outcome with the schema-aware client.
- **Reject the whole batch on an unexpected error mid-batch**: that is what happens. Returning per-event `REJECTED INTERNAL_ERROR` would make clients drop retryable events into the failed state.
- **Feed rows on every heartbeat**: one row per device every few seconds for a value D4 can poll.

## Consequences

- Conflict classification (#54) replaces rule 4 for the facts it holds instead of rejecting.
- The reason lists are provisional until checked against the Figma chips.
- Spec edits in this PR: `sync/push-protocol.md`.
