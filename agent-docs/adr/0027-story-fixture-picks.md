# ADR 0027: Story fixture picks from the reference CSVs

- Status: proposed
- Date: 2026-10-03
- Issue / PR: #24
- Designathon departure: yes (covered by ADR 0008, label `designathon-departure`)

## Context

ADR 0008 replaces the design's invented IDs (`OUT015`, `VEH001`, `T001`) with rows picked from the reference CSVs, using the criteria in [seed-and-demo.md](../spec/data/seed-and-demo.md) §15.5. Running the picker (#24) showed what those criteria leave open:

- `outlets.csv` records a district but no locality, so no outlet can be identified as being in Wellawatte or near Talawakele.
- "Nearest Colombo Fresh outlet" cannot be measured: the data has no coordinates, and `district_travel.csv` gives one distance per district.
- The CSVs hold no trips, drivers or loaders. Trip display IDs (`T001`) are assigned by the allocator when a plan is proposed, and are globally unique in the database.
- §15.5 says "an outlet served by that trip" without saying which stop.

## Decision

`pnpm seed:pick-fixtures` (`apps/api/prisma/seed/pick-fixtures.ts`) reads only `outlets.csv`, `vehicles.csv`, `district_travel.csv`, `service_allowance.csv` and `calendar.csv` from `data/reference/`. It writes `apps/api/prisma/seed/story-fixtures.ts`. Candidates are always taken in ID order. Every feasibility question goes to `packages/rules` (`validateTrip`, `computeEtas`) for the story date, Tue 29 Sep 2026. A trip counts only if it has no hard violation and no warning.

- **Hill district**: Talawakele lies in Nuwara Eliya district, which `district_travel.csv` lists as a `hill` district served from Kandy.
- **Walkthrough vehicle and trip**: the first Kandy reefer truck whose Fresh trip 1 to Nuwara Eliya takes at least 4 Fresh outlets there, adding outlets in ID order while the trip stays clean, up to 5 stops (the D4 card reads "stop 3 of 5"). Trucks only, because Sampath drives a reefer truck (design/product-and-roles.md). The stop order is the one `computeEtas` gives.
- **Hill store outlet**: stop 2. Stop 1 is delivered online (walkthrough step 8), so stop 2 is the first delivery made offline. That is the delivery whose store sees the delayed confirmation.
- **Peak-day store outlet (Dilini)**: no Wellawatte outlet can be found, so the fallback applies. It is the first Colombo Fresh outlet served from Peliyagoda, by ID, that a Peliyagoda reefer truck can serve on a clean single-stop trip. This drops the `van_only` street outlets, because the story delivers it on a truck.
- **The trip placeholder `T001`** is pinned as vehicle, trip number, brand, district and stop order. Its display ID is whatever the plan assigns.
- **Driver and loader IDs**: a driver's display ID follows the vehicle number (`DRV001` drives `VEH001`, as Ruwan S. in §15.3 already does). The Kandy loader is `LDR002`, the next ID after the Peliyagoda loader `LDR001`.

Picks on the committed CSVs: `OUT004` (peak-day store), `VEH039` and `DRV039` (Sampath), the Nuwara Eliya Fresh trip `OUT105 → OUT108 → OUT104 → OUT106 → OUT107` (266 of the 270 Fresh minutes), `OUT108` (hill store), `LDR002` (Kandy loader).

## Alternatives considered

- Hand-pick IDs in the docs: not reproducible, and nothing checks them against the rules.
- Add a locality column to `outlets.csv`: this edits an approved reference file and invents data.
- Pin the trip display ID `T001` in the fixtures: it would clash with the allocator's numbering and the global unique index.
- Choose the hill store at random from the trip: not deterministic, and the walkthrough needs the store's stop to be one delivered offline.

## Consequences

The seed (#30), e2e tests and docs import IDs from `story-fixtures.ts` and never write them by hand. A test fails if the committed module and a fresh run differ, or if `outlets.csv` gains columns (a locality column would reopen the Wellawatte choice). Changing the criteria means editing the picker and running it again. Spec edited: `data/seed-and-demo.md` (§15.3, §15.5), `overview.md`, `open-questions.md`. Design docs edited: `design/mock-story.md`, `design/product-and-roles.md`.
