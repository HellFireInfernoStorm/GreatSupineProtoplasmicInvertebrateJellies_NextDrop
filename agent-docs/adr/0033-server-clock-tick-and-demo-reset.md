# ADR 0033: Server clock scope, the planning-day tick and the demo reset

- Status: accepted
- Date: 2026-10-03
- Issue / PR: #38
- Designathon departure: no

## Context

[seed-and-demo.md](../spec/data/seed-and-demo.md) §15.2 and [planning flow](../spec/planning/flow.md) ask for a server clock (`now = realNow + offset`), a `tick` job that closes the planning day at cutoff, and `POST /demo/reset` presets. Issue #38 builds the clock, the tick and the `before-cutoff` preset. The spec leaves these open:

1. Which time sources follow the demo clock. Moving it 16 hours, as the walkthrough does, would expire every 12-hour web session if session expiry read it too.
2. Where planning days come from: nothing creates them before the tick.
3. What "restore operational tables" clears, and how. `order_events` and `plan_versions` reject `UPDATE` and `DELETE` (ADR 0023).
4. The `before-cutoff` instant.
5. Issue #38 asks for a "confirm flag", but the contract bodies are strict (`{ serverTime }`, `{ preset }`).

## Decision

1. **Clock scope.** Business time follows the demo clock: every `serverTime` in a response, cutoffs and state transitions (the tick), ETAs, and notification read times. Security timing keeps real time: session expiry and sliding, login lockout, rate limits, and the SSE stream's session check. The offset is `DemoState.clockOffsetMs`, read at startup and held in memory (the API runs as one container, as ADR 0028 already assumes). It applies only with `DEMO_MODE=true`.
2. **Tick.** For every depot, the tick makes sure the orderable date (`deliveryDateFor(today, now)`) has an OPEN planning day. It then closes every OPEN day whose cutoff has passed, setting `ordersClosedAt` to the cutoff instant. Each close notifies that depot's dispatchers (`orders_closed`, params `depot`, `date`, `orders`) and appends the feed rows last, in the same transaction. A conditional update makes concurrent ticks count a day once. pg-boss runs the tick every minute (`JOBS_ENABLED=false` turns it off), and `POST /demo/tick` runs it on demand.
3. **Reset.** A reset truncates the operational tables in one statement: conflicts, blobs, plans, trips, deferrals, orders with their lines and events, outlet service state, vehicle availability, notifications and planning days. `TRUNCATE` fires no row-level triggers, so the event log's immutability still holds for every other writer. It keeps reference data, products, users, sessions, devices, weekly history, the change feed and its counter. The SSE hub already polls `resetEpoch`, so clients see the reset without a feed row. The reset then runs the seed, which restores the story day and, because it writes, increments `resetEpoch` once (ADR 0030). Finally it moves the clock, runs the tick and records the preset, the actor (null for the script key) and the time.
4. **`before-cutoff`** is Mon 28 Sep 2026 14:00 Asia/Colombo: two hours before the cutoff for the story day, with the planning days for Tue 29 Sep OPEN.
5. **Confirmation** is the client's confirm step. The server enforces `DEMO_MODE`, a dispatcher session or the script key, CSRF, a per-route rate limit (10 per minute by default) and the actor record. A body flag would need a contract change. Presets other than `before-cutoff` return 409 `ILLEGAL_TRANSITION` until the tier S demo issue.

## Alternatives considered

- Everything on the demo clock: moving the clock would sign judges out mid-walkthrough.
- Planning days created by the seed or the planning API: the tick knows the cutoff and runs anyway.
- Disabling the immutability triggers during a reset: it weakens the guarantee for the window and needs owner-level SQL. `TRUNCATE` does not touch them.
- Deleting and recreating sessions on reset: judges would have to sign in again after every reset.

## Consequences

Any new time-driven path reads `app.clock.now()`, and any new security timer reads real time. A multi-instance deployment would need the offset re-read per request. Spec edited: `data/seed-and-demo.md` §15.2, `planning/flow.md` §8.1. README: `JOBS_ENABLED`, demo clock. Auth module: `serverTime` comes from the server clock.
