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
