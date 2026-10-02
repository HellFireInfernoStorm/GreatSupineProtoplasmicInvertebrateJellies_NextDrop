---
status: draft
owner: Dinura
sources: guide §8.3
---

# Other planning behaviours

## 8.3 Other planning behaviours

- **Fleet and availability**: the Fleet screen toggles `VehicleAvailability` through `VEHICLE_AVAILABILITY_CHANGED` (reason `SERVICE` or `BREAKDOWN`). Workshop vehicles are excluded from proposals and fail validation (`VEHICLE_UNAVAILABLE`).
- **Vehicle breakdowns** (ADR 0017):
  - A driver's `PROBLEM_FLAGGED` with kind `VEHICLE_PROBLEM` reaches the dispatcher as a needs-action notification and an inbox item.
  - The dispatcher marks the vehicle broken down, which sets it `IN_WORKSHOP` for the date. The dispatcher, and the loaders and drivers of the vehicle's trips, are notified.
  - Trips on that vehicle that have not departed fail `VEHICLE_UNAVAILABLE` and are fixed by republishing. `LOADED` orders follow the reversal flow (ADR 0004).
  - On a departed trip, the driver records the remaining stops `FAILED` with reason `VEHICLE_BREAKDOWN`. Those orders return to planning (`FAILED -> PLANNED | DEFERRED`). Nothing is re-planned automatically.
- **Repeat-skip guard**: re-deferring an outlet deferred last run raises `REPEAT_DEFERRAL` (warn) and requires a note.
- **Next-day rollover**: deferred orders get `currentDate` = next operating date and re-enter that day's queue with incremented `deferredCount`.
- **Exceptions handling** (short/damaged flags, disputes, clashes, failed stops) is a dispatcher inbox fed by events; resolving emits events (section 7.2).
- **Shortfalls**: each `LOAD_SHORT` line lands in the dispatcher inbox. The system proposes `SHIP_PARTIAL`; the dispatcher confirms or picks `HOLD_TRIP` or `BACKORDER` with `SHORT_RESOLVED`. `TRIP_READY` is blocked until every short line is resolved; the trip shows 'waiting on dispatcher' meanwhile (ADR 0005).
- **Deferral consequences** are stored with every deferral (see [deferral-explanation.md](../rules-core/deferral-explanation.md)) and used in store notices and the defer-review sort.
