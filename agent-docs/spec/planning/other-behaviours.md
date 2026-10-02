---
status: draft
owner: Dinura
sources: guide §8.3
---

# Other planning behaviours

## 8.3 Other planning behaviours

- **Fleet and availability**: the Fleet screen toggles `VehicleAvailability`; workshop vehicles are excluded from proposals and fail validation.
- **Repeat-skip guard**: re-deferring an outlet deferred last run raises `REPEAT_DEFERRAL` (warn) and requires a note.
- **Next-day rollover**: deferred orders get `currentDate` = next operating date and re-enter that day's queue with incremented `deferredCount`.
- **Exceptions handling** (short/damaged flags, disputes, clashes, failed stops) is a dispatcher inbox fed by events; resolving emits events (section 7.2).
- **Shortfalls**: each `LOAD_SHORT` line lands in the dispatcher inbox. The system proposes `SHIP_PARTIAL`; the dispatcher confirms or picks `HOLD_TRIP` or `BACKORDER` with `SHORT_RESOLVED`. `TRIP_READY` is blocked until every short line is resolved; the trip shows 'waiting on dispatcher' meanwhile (ADR 0005).
- **Deferral consequences** are stored with every deferral (see [deferral-explanation.md](../rules-core/deferral-explanation.md)) and used in store notices and the defer-review sort.
