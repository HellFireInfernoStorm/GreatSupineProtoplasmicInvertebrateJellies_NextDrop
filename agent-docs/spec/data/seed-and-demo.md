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
4. One realistic **peak day**: orders for the story delivery date at Peliyagoda, Fresh-heavy with a festival ramp, exceeding available capacity (about 86 orders), with several vehicles in the workshop, a mix of dry and chilled orders (including outlets with two orders), `van_only` and mall outlets, and prior-day deferral state (`deferred_yesterday`, `days_since_last_served`).
5. **Story fixtures** from the design (named orders such as ORD10412, a loader shortfall, a deferred order, a dispute, an offline clash scenario) layered over generated bulk, generated deterministically from a fixed seed.
6. Aggregated `WeeklyDemandHistory` (about 12 weeks) for the capacity outlook.
7. Outlet service state and a handful of Kandy depot orders so both depots are visible.

Seeding is idempotent and runs on every start when `SEED_ON_START=true`. Historic/Training/Test Datathon files are never seeded (section 20).

## 15.2 Demo tooling (`DEMO_MODE=true`)

- **Demo clock**: server `Clock` service (`now = realNow + offset`); all cutoff, state-transition and ETA logic reads it. `POST /demo/clock` sets the time; a `tick` job (and `POST /demo/tick`) applies time-driven transitions idempotently.
- **Reset and presets**: `POST /demo/reset { preset }` restores operational tables to a known checkpoint: `before-cutoff`, `orders-closed`, `plan-published`, `loading`, `mid-run`, `clash-ready`. A judge can jump to any role's step.
- **Reset epoch and visibility** (ADR 0007): every reset or seed increments `DemoState.resetEpoch`. Reset and clock changes need a confirm step, are rate-limited, and the actor and time are shown in a persistent banner in every shell ('Reset by dispatcher at 14:02'). The README advises judges who need isolation to run `docker compose up` locally.
- **Quick-login chips** on the login screens for the four seeded accounts.
- **Force-offline switch** in Loader/Driver (section 10).
- Demo controls are reachable from a small panel in each shell footer; clock/reset are dispatcher-only (or script key).

## 15.3 Seeded accounts (credentials documented in README, not committed as secrets beyond demo values)

| Role | Login | Notes |
| --- | --- | --- |
| Store manager | outlet `OUT004` / Dilini | Waypoint Fresh, Colombo (Peliyagoda-served); the design's Wellawatte `OUT015` (15.5) |
| Dispatcher | Nimal, Peliyagoda | Depot selector available |
| Loader | `LDR001`, Peliyagoda dock | PIN login |
| Driver | Sampath, `DRV039` on `VEH039`, Kandy depot (IDs from `story-fixtures`) | The walkthrough driver on the Kandy hill run; PIN login |
| Extras | `DRV001` Ruwan S. (Peliyagoda), Kandy loader `LDR002`, a second store manager at `OUT108` (hill store) | Second driver; Kandy and multi-outlet scenarios |

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
- The walkthrough vehicle is the first Kandy reefer truck whose Fresh trip 1 to Nuwara Eliya takes 4 to 5 of that district's Fresh outlets, added in ID order while the trip stays clean. The hill store is stop 2, the first stop delivered offline (stop 1 is delivered online in step 8).
- Driver display IDs follow the vehicle number (`DRV001` drives `VEH001`). The Kandy loader is `LDR002`. The trip's display ID is assigned by the plan, so the fixtures pin the trip as vehicle, trip number, brand, district and stops.

Picks on the committed CSVs (#24):

| Fixture | Pick | Replaces |
| --- | --- | --- |
| Peak-day store (Dilini) | `OUT004`: Fresh, Colombo, Peliyagoda, street dock, normal parking, window 05:30–08:00 | `OUT015` (Wellawatte) |
| Walkthrough vehicle | `VEH039`: Kandy reefer truck, 6,180 kg / 29.9 m³ | `VEH001` |
| Walkthrough driver | `DRV039` Sampath | |
| Walkthrough trip | `VEH039` Fresh trip 1, Nuwara Eliya: `OUT105` 05:21 → `OUT108` 05:56 → `OUT104` 06:31 → `OUT106` 07:06 → `OUT107` 07:41 (validation ETAs, departure 03:30, 266 of 270 Fresh minutes) | `T001` |
| Hill store (delayed confirmation) | `OUT108`: Fresh, Nuwara Eliya, rear dock, window 04:00–07:45 | |
| Kandy loader | `LDR002`, Kandy depot | |
| Depots and districts | Peliyagoda / Colombo; Kandy / Nuwara Eliya | |

To change a pick, change the criteria in `apps/api/prisma/seed/pick-fixtures.ts` and run `pnpm seed:pick-fixtures`. A test fails when the committed `story-fixtures.ts` differs from a fresh run.
