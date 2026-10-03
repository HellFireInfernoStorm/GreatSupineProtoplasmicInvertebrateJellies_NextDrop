---
status: draft
owner: Dinura
sources: guide §15
---

# Seed data, demo tooling and judge walkthrough

## 15.1 What a fresh `docker compose up` creates

1. Reference tables from `data/reference/*.csv` (outlets, vehicles, calendar, district travel, service allowance, traffic speed, road conditions).
2. A synthetic `Product` catalogue per brand with unit weights/volumes (order weight and volume are computed from lines so capacity maths is consistent with receipt steppers).
3. Users and accounts (15.3); a `Driver` record for every vehicle.
4. One realistic **peak day**: 86 Fresh-heavy orders for the story delivery date at Peliyagoda, generated from a fixed PRNG seed. They include:
   - 13 vehicles in the workshop, one of them a breakdown. Demand exceeds capacity: `proposePlan` serves 80 orders and defers 6;
   - a mix of dry and chilled orders, including outlets with both;
   - `van_only` and mall outlets;
   - prior-day deferral state (`deferred_yesterday`, `days_since_last_served`).

   `calendar.csv` ends in June 2026, so the story date carries no festival ramp. Dilini's outlet has no bulk order: Dilini places it live in step 1.
5. **Story fixtures** (`story.ts`, a separate file from the bulk generator): the Kandy orders for the hill trip, among them the design's ORD10412 (chilled, carried over from the previous run) and ORD10468 (dry), both at the hill store. The seed stops at the start of the story. The loader shortfall, offline deliveries, clash and dispute need published plans, so the demo presets reach them.
6. Aggregated `WeeklyDemandHistory`: 12 ISO weeks before the story week, per depot and brand, for the capacity outlook.
7. Outlet service state for every outlet, and a handful of other Kandy depot orders so both depots are visible.

Every seeded order has an `ORDER_PLACED` event (by the outlet's store account where one exists, otherwise by the dispatcher) and an `ORDER_DEFERRED` event, by the dispatcher, for each earlier deferral. Event payloads pass the contracts schemas. Workshop vehicles carry a `VEHICLE_AVAILABILITY_CHANGED` event.

Seeding is idempotent and runs on every start when `SEED_ON_START=true` (`pnpm db:seed` runs it by hand). Each run is one of two kinds (ADR 0030):
- **Compare and update:** reference data, products, accounts, drivers and weekly history are compared with the seed by natural key and updated where they differ.
- **Create only when missing:** orders, vehicle availability, outlet service state and `DemoState`. A restart therefore never reverts demo progress.

A second run on a seeded database writes nothing. Historic/Training/Test Datathon files are never seeded (section 20).

## 15.2 Demo tooling (`DEMO_MODE=true`)

- **Demo clock**: server `Clock` service (`now = realNow + offset`); all cutoff, state-transition and ETA logic reads it. `POST /demo/clock` sets the time; a `tick` job (and `POST /demo/tick`) applies time-driven transitions idempotently.
- **Reset and presets**: `POST /demo/reset { preset }` restores operational tables to a known checkpoint: `before-cutoff`, `orders-closed`, `plan-published`, `loading`, `mid-run`, `clash-ready`. A judge can jump to any role's step.
- **Reset epoch and visibility** (ADR 0007, ADR 0030): every reset increments `DemoState.resetEpoch`. The seed creates `DemoState` with epoch 1, and increments the epoch only when a run wrote something, so a restart that finds everything in place keeps field outboxes. Reset and clock changes need a confirm step, are rate-limited, and the actor and time are shown in a persistent banner in every shell ('Reset by dispatcher at 14:02'). The README advises judges who need isolation to run `docker compose up` locally.
- **Quick-login chips** on the login screens for the four seeded accounts.
- **Force-offline switch** in Loader/Driver (section 10).
- Demo controls are reachable from a small panel in each shell footer; clock/reset are dispatcher-only (or script key).

## 15.3 Seeded accounts (credentials documented in README, not committed as secrets beyond demo values)

| Role | Login | Notes |
| --- | --- | --- |
| Store manager | outlet `OUT004` / Dilini | Waypoint Fresh, Colombo (Peliyagoda-served); the design's Wellawatte `OUT015` (15.5) |
| Dispatcher | `nimal@waypoint.test` / Nimal | All depots (`User.depot` null); Peliyagoda by default, depot selector available |
| Loader | `LDR001` / Kasun, Peliyagoda dock | PIN login |
| Driver | `DRV039` / Sampath on `VEH039`, Kandy depot (IDs from `story-fixtures`) | The walkthrough driver on the Kandy hill run; PIN login |
| Extras | `DRV001` Ruwan S. on `VEH001` (Peliyagoda); Kandy loader `LDR002` / Pradeep; hill-store manager `OUT104` / Ishara | Second driver; Kandy and multi-outlet scenarios |

Store and dispatcher accounts share one demo password, and loaders and drivers one demo PIN (`apps/api/prisma/seed/accounts.ts`, listed in the README). Secrets are stored as argon2 hashes. Every vehicle has a `Driver` whose display ID follows the vehicle number.

## 15.4 Reference judge walkthrough (basis for the README and the Playwright test)

1. Reset to `before-cutoff`. **Store**: sign in on a phone-width window, see the cutoff countdown (server time), place a dry and a chilled order for tomorrow; receive confirmation.
2. Advance the demo clock past 16:00. Orders close.
3. **Dispatcher**: open the queue; see demand exceed capacity; **Propose plan**; inspect trips and capacity bars.
4. Attempt a rule-breaking move (e.g. chilled order onto an ambient truck): blocked with the reason. Make a valid edit.
5. Review deferrals: reason codes pre-filled with unavoidable vs choice; outlets skipped yesterday pinned. **Publish**.
6. **Store**: receives the deferral notice and ETA band.
7. **Loader** (phone and tablet widths): accept the plan; open the trip; load in reverse stop order; flag a shortfall; hold-to-mark ready.
8. **Driver**: start the run; deliver a stop with proof of delivery.
9. Switch the driver to force-offline; record two more stops offline (pending count visible).
10. **Dispatcher** edits a later stop and cancels a stop the driver already delivered offline. D4 shows the vehicle as no signal / last heard.
11. Driver reconnects: sync progress, plan-changed acknowledgement, and a clash card for the cancelled-but-delivered stop.
12. **Dispatcher** exceptions inbox shows the clash with the POD photo; resolve it.
13. **Store**: sees delivered (double timestamp), confirms receipt of one order, reports a shortage on another.
14. **Dispatcher** resolves the dispute; opens the capacity outlook.

## 15.5 Story fixtures (ADR 0008)

The invented design IDs (`OUT015`, `VEH001`, `T001`) are placeholders. A script run at seed time (`pnpm seed:pick-fixtures`) selects real rows from the reference CSVs and writes them to `apps/api/prisma/seed/story-fixtures.ts`, the single module that seed, e2e tests and docs import. Criteria:

- **Driver vehicle**: a Kandy-depot vehicle; its Fresh or Style trip includes a stop in the hill district used for the low-coverage scene (Talawakele area).
- **Store outlet receiving that delivery**: an outlet served by that trip, brand Fresh if the vehicle is a reefer.
- **Peak-day store outlet** (steps 1, 5, 6): a Fresh outlet in Wellawatte served from Peliyagoda if one exists in `outlets.csv`; otherwise the nearest Fresh outlet in Colombo served from Peliyagoda. Dilini's account is bound to it.
- **Overload demo**: the Peliyagoda peak day (dispatcher steps 3 to 5) is unchanged. The field steps 7 to 12 run on the Kandy depot with the pinned vehicle, driver and loader, and the dispatcher switches depot with the selector.
- The dispatcher's 'no signal' card (D4) and the store's delayed-confirmation view use the same driver and trip.

The picker reads only the approved reference CSVs and takes candidates in ID order. It asks `packages/rules` (`validateTrip`, `computeEtas`) for every feasibility check on the story date, Tue 29 Sep 2026, and accepts a trip only with no violation or warning (ADR 0027). `outlets.csv` records districts but not localities, so the criteria resolve as follows:

- "Talawakele area" is Nuwara Eliya district, a `hill` district served from Kandy.
- No outlet can be identified as Wellawatte, and every Colombo outlet is the same distance from Peliyagoda. The peak-day store is therefore the first Colombo Fresh outlet, by ID, that a Peliyagoda reefer truck can serve. This skips the `van_only` street outlets.
- The walkthrough vehicle is the first Kandy reefer truck whose Fresh trip 1 to Nuwara Eliya takes 4 of that district's Fresh outlets, added in ID order while the trip stays clean. The trip carries a chilled order at every stop and a dry order at the store stop, since step 13 needs two orders at one store. The Booklet counts trip time per order, so that is 5 orders (ADR 0030). The 4 stops serve steps 8 to 11: stop 1 is delivered online, stops 2 and 3 offline (the dispatcher then cancels stop 3), and stop 4 is edited.
- The hill store is stop 2, the first stop delivered offline.
- Driver display IDs follow the vehicle number (`DRV001` drives `VEH001`). The Kandy loader is `LDR002`. The trip's display ID is assigned by the plan, so the fixtures pin the trip as vehicle, trip number, brand, district and stops.

Picks on the committed CSVs (#24, re-picked in #30):

| Fixture | Pick | Replaces |
| --- | --- | --- |
| Peak-day store (Dilini) | `OUT004`: Fresh, Colombo, Peliyagoda, street dock, normal parking, window 05:30–08:00 | `OUT015` (Wellawatte) |
| Walkthrough vehicle | `VEH039`: Kandy reefer truck, 6,180 kg / 29.9 m³ | `VEH001` |
| Walkthrough driver | `DRV039` Sampath | |
| Walkthrough trip | `VEH039` Fresh trip 1, Nuwara Eliya: `OUT105` 05:21 → `OUT104` 05:56 and 06:31 (two orders) → `OUT106` 07:06 → `OUT107` 07:41 (validation ETAs, departure 03:30, 5 orders, 266 of 270 Fresh minutes) | `T001` |
| Hill store (delayed confirmation) | `OUT104`: Fresh, Nuwara Eliya, rear dock, window 03:00–08:00; ORD10412 (chilled) and ORD10468 (dry) | |
| Kandy loader | `LDR002`, Kandy depot | |
| Depots and districts | Peliyagoda / Colombo; Kandy / Nuwara Eliya | |

To change a pick, change the criteria in `apps/api/prisma/seed/pick-fixtures.ts` and run `pnpm seed:pick-fixtures`. A test fails when the committed `story-fixtures.ts` differs from a fresh run.
