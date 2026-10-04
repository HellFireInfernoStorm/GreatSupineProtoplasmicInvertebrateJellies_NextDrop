# ADR 0042: Store deliveries, tracking, receipt and issues: routes and departures

- Status: proposed
- Date: 2026-10-04
- Issue / PR: #44
- Designathon departure: yes (label `designathon-departure`)

## Context

Issue #44 builds the rest of the Store app from the Figma frames: My deliveries (desktop `230:136`, phone `248:960`, `235:832`), the silent-driver state (`491:1402`, `491:1651`, `491:1796`), order tracking (`232:587`, `249:1260`), the order timeline and detail (`250:1208`, `250:1429`, dialogs `233:874`, `233:966`), confirm receipt (`235:944`, `234:803`) and report an issue (`235:1029`, `234:893`). Some of what the frames draw is not in what the API gives a Store user.

## Decision

1. **Routes.** `/store` (My deliveries), `/store/tracking`, `/store/orders/:id` (timeline and detail), `/store/orders/:id/receipt` and `/store/orders/:id/issue`.
2. **One board.** My deliveries and Order tracking read the same data: `GET /store/deliveries` for today and for the next delivery day, and `GET /store/orders?status=DEFERRED`. They are polled every 30 s (deferred orders every 60 s), the fallback of `spec/sync/change-feed.md`.
3. **A run is only as far along as its slowest order.** The orders of one trip make one hero card. Its status is the least advanced order's status. "No signal" is shown when the server says so and no delivery record has arrived; once one has, the card shows both times ("Delivered 06:12 on the driver's phone", "Confirmed 07:40 after sync") and the receipt opens.
4. **Receipt is pre-filled from the driver's record** (`qtyDelivered`) and sends every line. A count can be lowered or raised up to the ordered quantity; the screen then asks the manager to report an issue as well.
5. **Departures from the frames:**
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

- Spec edited: `frontend/architecture.md`.
- Mock mode has a delivery story with four moments, chosen with `?mock=onway|nosignal|delivered|evening` (`apps/web/src/lib/api/mockDeliveries.ts`).
- Order history, the notifications panel and feed-driven refresh are tracked on #44.
