---
status: draft
owner: Dinura
sources: guide §5.2
---

# Validator codes

## 5.2 Validator codes

HARD: `WEIGHT_CAP_EXCEEDED`, `VOLUME_CAP_EXCEEDED`, `REEFER_REQUIRED`, `VAN_REQUIRED`, `DEPOT_MISMATCH`, `MIXED_BRAND`, `MIXED_DISTRICT`, `ORDER_SPLIT`, `ORDER_UNASSIGNED_UNKNOWN`, `TRIP_LIMIT_EXCEEDED`, `TIME_BUDGET_EXCEEDED`, `WINDOW_MISSED`, `MALL_WINDOW_VIOLATION`, `NON_OPERATING_DAY`, `FUEL_QUOTA_EXCEEDED`, `VEHICLE_UNAVAILABLE`, `ORDER_NOT_CONFIRMED`, `ORDER_ALREADY_LOADED` (a publish removes or moves a `LOADED` order without a reversal request, ADR 0004).
WARN: `LATE_RISK`, `REPEAT_DEFERRAL`, `LOW_FUEL_MARGIN`.

`LATE_RISK` is also raised when only the conservative display ETA (with return leg and reload buffer) misses a window (ADR 0003). A violation of `FUEL_QUOTA_EXCEEDED` carries the affected date in its params (ADR 0006).

Meanings settled in ADR 0021:

- `ORDER_UNASSIGNED_UNKNOWN`: a trip holds an order that is not in the day's confirmed orders, or whose outlet is unknown. Unassigned orders are not a validator error; publish requires their reasons (`MISSING_DEFERRAL_REASON`).
- `MALL_WINDOW_VIOLATION`: a mall outlet's stop starts after the mall window closes, or the outlet and mall windows do not overlap. Any other late stop is `WINDOW_MISSED`.
- `ORDER_NOT_CONFIRMED`: delivery date differs from the plan's date, or the status is not ORDERED, PLANNED, DEFERRED, FAILED or LOADED.
- `TRIP_LIMIT_EXCEEDED`: more than two trips, a trip number outside 1..2, or a repeated trip number on one vehicle.
- `LOW_FUEL_MARGIN`: less than `lowFuelMarginPct` (default 10) of the weekly quota left after this plan.
- `REPEAT_DEFERRAL`: one per deferral of an outlet deferred on the last run; params carry `noteProvided`.
- `message_key` is `validator.<CODE>`; `params.limit` and `params.actual` are in the rules core's integer units.
