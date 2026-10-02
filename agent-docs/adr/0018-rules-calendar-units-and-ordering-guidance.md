# ADR 0018: Rules core calendar fallback, integer fuel units and ordering guidance

- Status: accepted
- Date: 2026-10-03
- Issue / PR: #27
- Designathon departure: no

## Context

Issue #27 builds the config, units and calendar layer of `packages/rules`. The spec left four details open:

- `calendar.csv` ends on 2026-06-28, but the demo story and the live deployment run in September and October 2026 ([cutoff-and-calendar.md](../spec/domain/cutoff-and-calendar.md)).
- [units-and-time.md](../spec/domain/units-and-time.md) makes weight and volume integers but says nothing about distance or fuel, which come as decimals (`km_per_l = 4.7`).
- `cutoffAt(date)` has to return an instant without a time-zone library or `Date.now()`.
- `orderingGuidance` (ADR 0010) has a signature but no rules beyond "Style weekly day, Fresh chilled days, Tech single items".

## Decision

1. **Dates outside `calendar.csv`** are operating Monday to Saturday and closed on Sunday, with no holiday, festival, payday or monsoon, and an ISO week computed from the date. This follows the Booklet's "Waypoint operates Monday through Saturday". Dates inside the file use `is_operating` as given. Some holidays operate (Vesak) and some do not (New Year).
2. **Integer distance and fuel.** Distances are metres, fuel is millilitres, and `km_per_l` becomes metres per litre. Each input is rounded to three decimals, the same rule as kg -> g and m³ -> L.
3. **Cutoff instant.** Asia/Colombo is a fixed UTC+05:30 with no daylight saving, so `cutoffAt(D)` returns the UTC epoch milliseconds of `cutoffMinute` (16:00) on D-1 from plain date arithmetic. `deliveryDateFor(requestedDate, placedAt, calendar)` first rolls a non-operating request to the next operating date. Then, while the order was placed at or after that date's cutoff, it moves to the next operating date. It never returns a date before the day of placement.
4. **Ordering guidance** returns one message key:

   | Case | Key |
   | --- | --- |
   | any brand, non-operating date | `ordering.nonOperatingDay` |
   | Fresh | `ordering.fresh.separateChilled` (dry and chilled are separate orders) |
   | Style, `festival_ramp > 0` | `ordering.style.peakAhead` (order larger ahead of the festival) |
   | Style, otherwise | `ordering.style.weeklyDay` |
   | Tech | `ordering.tech.singleItems` |

   The function keeps the `| null` return type so a brand can have no notice later.

## Alternatives considered

- Extend `calendar.csv` by hand to cover 2026: invents holidays the organisers did not publish, and the file is organiser data.
- Treat dates beyond the file as non-operating: the demo day would have no operating dates at all.
- Decimal fuel (float litres): quota comparisons would depend on rounding order. Integer millilitres keep them exact.
- A time-zone library (Luxon) in the rules core: breaks the zero-dependency rule for a zone with a fixed offset.
- Per-outlet Style delivery days in guidance: the reference data has no scheduled day per outlet, and the signature takes no outlet.

## Consequences

- If the organisers publish a longer calendar, dropping it into `data/reference/` replaces the fallback with no code change.
- Spec edited: `spec/domain/units-and-time.md`, `spec/domain/cutoff-and-calendar.md`, `spec/rules-core/api-surface.md`, `spec/rules-core/config.md`.
