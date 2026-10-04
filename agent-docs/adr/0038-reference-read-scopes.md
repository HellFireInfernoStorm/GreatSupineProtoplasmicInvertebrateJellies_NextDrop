# ADR 0038: Reference read scopes and the calendar range

- Status: proposed
- Date: 2026-10-04
- Issue / PR: #110
- Designathon departure: no

## Context

[api.md](../spec/platform/api.md) lists `GET /ref/{outlets,vehicles,products,calendar,reasons}` for all roles, "scoped", and [api-dtos.md](../spec/platform/api-dtos.md) says the optional `depot` query never overrides authorization. Neither says how a role is scoped to products, which have no depot or outlet. Neither says what a store or driver sees of the fleet and outlets, or how large a calendar range may be. Issue #110 asks for: a store's own outlet and its brand's products; a dispatcher's depots; a loader's depot; a driver's own vehicle and the outlets on its trips.

## Decision

1. **Outlets and vehicles** use the policy layer's `scoped(actor)` clauses (ADR 0028), ANDed with `?depot=` when given:
   - A store sees its own outlet, plus only the vehicles whose trips carry one of its orders.
   - A dispatcher sees every outlet and vehicle in its depots.
   - A loader sees every outlet and vehicle in its own depot.
   - A driver sees its own vehicle, plus the outlets with an order on one of that vehicle's trips (any date). Before any plan places it on a trip, that list is empty.

   A depot outside the scope returns an empty list, not 403.
2. **Products.** A store sees its outlet's brand catalogue. Every other role sees the whole catalogue: dispatchers plan all brands, and field roles see every brand on a trip. `?depot=` does not apply to products and is ignored. `unitWeightG` is the stored kilograms × 1000, unrounded ("as stored").
3. **Vehicles without a driver record** are left out of `/ref/vehicles`, because the DTO requires the driver's name and phone. The seed gives every vehicle a driver.
4. **Calendar.** `/ref/calendar` returns one entry per date from `from` to `to`, both inclusive. A date missing from the reference table follows the rules defaults (ADR 0018), the same calendar the planner uses. `from` must not be after `to`, and the range may cover at most 366 days. Anything else is 400 `SCHEMA_INVALID`.
5. **Reasons** are the same lists as the field snapshot's `config.reasons` (ADR 0034), the same for every role.

## Alternatives considered

- **Brand-scoped products for every role**: field roles and dispatchers have no single brand.
- **403 for a depot outside the scope**: the spec treats `depot` as a selection that never widens authorization. An empty list keeps every reference list a pure scoped read.
- **An unbounded calendar range**: a session could ask for millions of computed days in one request.

## Consequences

- The reference reasons moved from the field module to the reference module, which the field snapshot now reads. The vehicle DTO conversion is shared the same way.
- Spec edit in this PR: `platform/api-dtos.md` (reference lists).
