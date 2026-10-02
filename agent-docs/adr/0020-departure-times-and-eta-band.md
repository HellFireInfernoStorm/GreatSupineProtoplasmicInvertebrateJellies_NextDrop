# ADR 0020: Trip departure times, trip end and the store ETA band

- Status: accepted
- Date: 2026-10-03
- Issue / PR: #32
- Designathon departure: no

## Context

Issue #32 implements the ETAs in [trip-time-and-budgets.md](../spec/domain/trip-time-and-budgets.md) §4.4. Four details were open:

- "Style/Tech departure is the earliest time that satisfies all stops' open times." With waiting allowed at stops, this could mean departing at 08:00 and waiting, or departing late enough not to wait.
- When trip 1 "ends" for the display ETA of trip 2.
- How the store-facing band of `ETA_WINDOW_MIN` sits around the ETA.
- How fractional fuel rounds.

## Decision

1. **Departure.** Fresh trip 1 departs at `FRESH_FIRST_DEPARTURE` (03:30). Every other trip departs at the latest of these times:
   - its earliest start: `TRADING_DAY_START` for Style/Tech; for trip 2, when trip 1 allows it under each ETA model (ADR 0003)
   - the first stop's effective window open minus the outbound time, so the vehicle does not wait at the first stop

   Later stops wait if the vehicle is early. Departing later and waiting at the first stop give the same stop times, so this only fixes the departure shown to the loader and driver.
2. **Trip end.** A trip ends when the vehicle leaves its last stop, waiting included. Trip 2's display departure is that end, plus the return leg (equal to the outbound time), plus `RELOAD_BUFFER_MIN`. Trip 2's validation departure stays trip 1's validation departure plus its `trip_minutes`, as in the Booklet.
3. **On time.** A stop is on time when unloading starts (arrival, or window open after waiting) no later than the effective window close. An outlet whose window does not overlap its mall window can never be on time.
4. **ETA band.** The band is `ETA_WINDOW_MIN` wide (default 30), centred on the display ETA, and starts on a 5-minute mark.
5. **Fuel.** Fuel per trip rounds up to the whole millilitre, so the weekly quota check is never optimistic.

## Alternatives considered

- Depart Style/Tech at 08:00 and wait at the first stop: the same ETAs, but the driver sees a departure time with a long idle wait.
- Depart late enough that no stop is reached early: can push later stops past their close.
- A band starting at the ETA: the store would read the earliest time as the latest.

## Consequences

Spec edited: `spec/domain/trip-time-and-budgets.md`.
