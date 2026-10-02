# ADR 0021: Validator code details

- Status: accepted
- Date: 2026-10-03
- Issue / PR: #34
- Designathon departure: no

## Context

Issue #34 implements every code in [validator-codes.md](../spec/rules-core/validator-codes.md). The list names the codes but leaves some meanings open:

- what `ORDER_UNASSIGNED_UNKNOWN` covers
- where `WINDOW_MISSED` ends and `MALL_WINDOW_VIOLATION` begins
- when `LOW_FUEL_MARGIN` fires
- what `REPEAT_DEFERRAL` reports

The publish transaction already rejects unassigned orders without a reason (`MISSING_DEFERRAL_REASON`, [publish-transaction.md](../spec/planning/publish-transaction.md) step 5).

## Decision

- **`ORDER_UNASSIGNED_UNKNOWN`** (HARD): a trip holds an order that is not in the day's confirmed orders, or whose outlet is unknown. Orders left unassigned are not a validator error. Drafts stay editable, and publish requires their reasons separately.
- **`MALL_WINDOW_VIOLATION`** (HARD): a mall outlet's stop starts after the mall window closes, or the outlet and mall windows do not overlap. Any other late stop is `WINDOW_MISSED`. Both use the validation ETA only (ADR 0003).
- **`LOW_FUEL_MARGIN`** (WARN): after this plan, less than `lowFuelMarginPct` (new config key, default 10) of the vehicle's weekly quota is left. `FUEL_QUOTA_EXCEEDED` replaces it when the quota is exceeded.
- **`REPEAT_DEFERRAL`** (WARN): one warning per deferral of an order whose outlet was deferred on the last run. Its params carry `noteProvided`, and the API enforces the note.
- **`ORDER_NOT_CONFIRMED`** (HARD): the order's delivery date is not the plan's date, or its status is not ORDERED, PLANNED, DEFERRED, FAILED or LOADED.
- **`TRIP_LIMIT_EXCEEDED`** (HARD): also covers a trip number outside 1..2, or two trips with the same number on one vehicle.
- **Violation shape:** `message_key` is `validator.<CODE>`. `params.limit` and `params.actual` use the rules core's integer units (grams, litres, minutes, millilitres).

## Alternatives considered

- Flag every unassigned order as `ORDER_UNASSIGNED_UNKNOWN`: every draft would be invalid until the review step, and `validateTrip` live checks would be noisy.
- Make `REPEAT_DEFERRAL` hard when the note is missing: the code is listed as a warning, and the note belongs to the deferral review form.

## Consequences

Spec edited: `spec/rules-core/validator-codes.md`, `spec/rules-core/config.md`.
