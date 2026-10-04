# ADR 0055: Capacity outlook window, fleet capacity and reefer limit

- Status: accepted
- Date: 2026-10-04
- Issue / PR: #190
- Designathon departure: no

## Context

The D5 Capacity outlook in the design (Figma `277:1215`) compares the forecast with "usable fleet at max 2 trips, fuel quota applied", and chilled forecast with reefer capacity, for the current week and the next six. The build counted every depot vehicle at one trip a day, had no reefer limit, and showed eight past weeks.

## Decision

- **Window.** D5 shows seven ISO weeks, starting with the week of the planning date. A week with seeded `WeeklyDemandHistory` reports it. A later week is the moving average of the four weeks before it, as before.
- **Usable fleet.** The depot's vehicles, less those `IN_WORKSHOP` on the first day of the window (`from`). Availability is recorded per date (ADR 0017), so later workshop days are not known.
- **Trips per vehicle per week.** `maxTripsPerVehicle` (2, from `packages/rules` config) times the week's operating Mon–Sat days from the calendar, read as the rest of the system reads it (a day missing from the calendar counts as operating Mon–Sat, ADR 0018), capped by the fuel quota: `floor(weeklyFuelQuotaL × kmPerL / typicalTripKm)`. `typicalTripKm` is the unweighted mean round trip from the depot to its districts (2 × `depotToDistrictKm`). A depot with no districts has no fuel cap.
- **Capacity.** `capacityVolumeL` is the sum of each usable vehicle's volume times its weekly trips. `reeferCapacityVolumeL` is the same over reefer vehicles, the limit for chilled demand, which is Fresh only.
- **Units.** m³, as ADR 0010 decided. The design's tonnes remain the departure recorded there.
- **Load labels.** Load is forecast over capacity. At 95% or more it is "tight", above 100% it is "over". A week has headroom when both fleet and reefer have 10% or more spare.

## Alternatives considered

- One trip per vehicle per day: understates a week's capacity by up to half, and the design asks for max 2 trips.
- Ignore the fuel quota: low-quota vehicles cannot run 12 trips a week, so capacity would be overstated.
- Simulate the week with the allocator: exact but costly per request, and future orders do not exist yet.

## Consequences

`GET /dispatch/outlook` items gain `reeferCapacityVolumeL` (contract change). Capacity can differ by week through the calendar. Spec edited: `platform/api-dtos.md`, `frontend/architecture.md`.
