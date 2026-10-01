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
