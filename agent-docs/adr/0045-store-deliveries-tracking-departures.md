# ADR 0045: Store deliveries, tracking, receipt and issues: routes and departures

- Status: proposed
- Date: 2026-10-04
- Issue / PR: #44
- Designathon departure: yes (label `designathon-departure`)

## Context

Issue #44 builds the rest of the Store app from the Figma frames: My deliveries (desktop `230:136`, phone `248:960`, `235:832`), the silent-driver state (`491:1402`, `491:1651`, `491:1796`), order tracking (`232:587`, `249:1260`), the order timeline and detail (`250:1208`, `250:1429`, dialogs `233:874`, `233:966`), confirm receipt (`235:944`, `234:803`) and report an issue (`235:1029`, `234:893`). Some of what the frames draw is not in what the API gives a Store user.

## Decision

1. **Routes.** `/store` (My deliveries), `/store/tracking`, `/store/orders/:id` (timeline and detail), `/store/orders/:id/receipt`, `/store/orders/:id/issue` and `/store/history`.
2. **One board.** My deliveries and Order tracking read the same data: `GET /store/deliveries` for today and for the next delivery day, and `GET /store/orders?status=DEFERRED`. A deferred order shows with the next delivery day only if it was requested for that day; any other deferred order is listed under "Moved orders". The board refreshes from the change feed (decision 3) and is also polled every 30 s (deferred orders every 60 s), the fallback of `spec/sync/change-feed.md`.
3. **The Store refreshes all its queries on any feed row.** The Store frame pulls `GET /changes` every 15 s. `spec/sync/change-feed.md` had online roles invalidate TanStack Query caches by `entity.type`. The Store does not pick: on a new row for its outlet it refreshes every query under the `store` key. Its queries are few and each screen shows several entity types at once (an order row changes the deliveries, the order, its timeline and the notifications), so a mapping from type to query would refresh most of them anyway. The first pull only sets the cursor. The Dispatcher keeps the spec's rule.
4. **A run is only as far along as its slowest order.** The orders of one trip make one hero card. Its status is the least advanced order's status. "No signal" is shown when the server says so and no delivery record has arrived; once one has, the card shows both times ("Delivered 06:12 on the driver's phone", "Confirmed 07:40 after sync") and the receipt opens.
5. **Receipt is pre-filled from the driver's record** (`qtyDelivered`) and sends every line. A count can be lowered or raised up to the ordered quantity; the screen then asks the manager to report an issue as well.
6. **An order that is already Disputed can take another report.** The server records a second issue without changing the status, so Report an issue stays open on a Disputed order.
7. **Departures from the frames:**
   - **The hero's progress bar follows the order's stages** (planned, loaded, out for delivery, delivered), not "stop 3 of 7 delivered". `GET /store/deliveries` returns a trip with only this outlet's stops, so the screen knows its own stop number and not the run's stop count. The line reads "you are stop 4", without "of 7".
   - **The vehicle is not named.** The trip carries the vehicle's UUID, not "VEH001 reefer".
   - **Timeline, detail, receipt and issue are pages on desktop**, not dialogs over My deliveries. Each has its own address, so a notification or a refresh lands on it.
   - **Order timeline and Order detail are one screen**: the timeline, then the lines.
   - **Report an issue has no photo.** `PUT /sync/blobs/:id` is open to Loader and Driver only, so a Store user cannot upload one. The frame's "Photo · required for warm or damaged" is left out until the route admits the Store role.
   - **"Wrong item" is "Something else"**: the contract's kinds are SHORT, DAMAGED, WARM and OTHER.
   - **Each timeline step shows "Captured" and "Confirmed"**, as the shared `Timeline` does for every role. The frame writes one time for server events and two for field facts.
   - **Quantities are "units"** in summaries. The frames say "crates" and "cases"; an order's lines can have different unit labels.

## Alternatives considered

- Adding `stopsTotal` and `stopsDone` to the deliveries response: a contract change close to the deadline. It can return the stop count to the hero later.
- Dialogs on desktop, as drawn: no address to link a notification to, and a second copy of each screen.
- A photo field that keeps the file in the browser only: the dispatcher would never see it.

## Consequences

- Spec edited: `frontend/architecture.md` (the Store routes) and `sync/change-feed.md` (how the Store refreshes).
- Mock mode has a delivery story with four moments, chosen with `?mock=onway|nosignal|delivered|evening` (`apps/web/src/lib/api/mockDeliveries.ts`).
- Still open on #44: the filled-in states have not been run against the Compose stack, and Report an issue has no photo.
