# ADR 0031: Store order writes, idempotency and the store's trip view

- Status: proposed
- Date: 2026-10-03
- Issue / PR: #42
- Designathon departure: no

## Context

Issue #42 implements the store endpoints of [API surface](../spec/platform/api.md) and [API wire DTOs](../spec/platform/api-dtos.md). Several details were left open: how an `Order` row gets its display ID and idempotency key, what happens to a mixed dry and chilled basket, how a repeated store command is treated, how much of a trip a store may see, and what "ordering open" means. The [order reducer](../spec/rules-core/order-reducer.md) and the [cutoff rules](../spec/domain/cutoff-and-calendar.md) stay authoritative.

## Decision

1. **One order, one temperature and the outlet's brand.** An `Order` row has one `tempRequirement` and one `brand`, so a basket mixing chilled and ambient products, a product of another brand, an unknown product or a repeated product is refused with 422 `VALIDATION_FAILED`. The client places dry and chilled as two orders. This is what the Fresh ordering guidance already asks for.
2. **Idempotency per outlet.** The `idempotency-key` header is stored as `<outletId>:<key>`. A retry with the same key returns the original order with 201. A concurrent duplicate fails its own transaction on the unique key and is answered by re-reading the winner, never by catching inside a transaction.
3. **Display IDs.** `ORD#####`: the highest existing `ORD` number plus one, starting at 10001, allocated under a transaction-scoped advisory lock.
4. **Target date and cutoff.** `currentDate` is `rules.deliveryDateFor(requestedDate, now)`. `GET /store/cutoff` returns that delivery date and its cutoff. `orderingOpen` is true when it equals the requested date (or the operating date that date rolls to). `guidanceKey` is `rules.orderingGuidance` for the requested date.
5. **Writes.** Each write runs one transaction, in this order:
   - a compare-and-set on `orders.status` (`where status = previous`), with the next status from `rules.applyEvent`
   - the server event (`capturedAt = receivedAt = server clock`)
   - any line updates or notifications
   - the feed rows, last

   `ILLEGAL_TRANSITION` from the reducer, or a lost race, returns 409.
6. **Repeated or late store commands.** When the reducer keeps the status (`IGNORED_EARLIER_STAGE`), cancel and receipt are refused with 409: the command would change nothing. An issue is still recorded, because a second issue on a disputed order is a new dispute to handle. A dispute after receipt is refused, because RECEIVED is terminal in the transition table.
7. **Notifications.** `ISSUE_REPORTED` notifies the dispatchers of the outlet's depot with `dispute_opened`, linked to `{ type: issue, id: <event id> }`.
8. **The store's trip view.** `GET /store/deliveries` returns each of the store's orders for the date with its trip. The trip lists only that store's stops (store scope). `deliveredAt` is the delivery fact's `capturedAt` and `confirmedAt` is its `receivedAt`, never merged. `signal` is NO_SIGNAL only while the trip is DEPARTED and the vehicle's driver devices have not been heard from for `NO_SIGNAL_AFTER_MIN` (10 minutes). `Order.confirmedAt` stays null at placement and is set by sync ingest when the delivery is confirmed.

## Alternatives considered

- **Split a mixed basket into two orders in one request**: the create response is a single order, so the client could not see the second.
- **A database sequence for display IDs**: a schema change for one counter. The advisory lock is cheap at this volume.
- **Record repeated cancels and receipts as no-ops**: the timeline would show actions that changed nothing.

## Consequences

- A web client places dry and chilled orders separately and reuses the same key on retry.
- Planning, ingest and dispute resolution use the same compare-and-set and feed-last pattern.
- Spec edits in this PR: `platform/api-dtos.md` (Store section).
