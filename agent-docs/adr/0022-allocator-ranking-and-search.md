# ADR 0022: Allocator ranking classes, placement order and local search

- Status: accepted
- Date: 2026-10-03
- Issue / PR: #37
- Designathon departure: no

## Context

Issue #37 implements `rankOrders`, `proposePlan` and `explainDeferral`. The spec leaves four points open or in tension:

- [priority-policy.md](../spec/domain/priority-policy.md) names class 4 "Style/Tech by most `days_since_last_served`" and class 5 "remaining Style/Tech" but does not say what separates them.
- [allocator.md](../spec/rules-core/allocator.md) stage 5 packs "for each group in priority order". A (brand, district) group mixes chilled and ambient Fresh, so packing one group whole would let its ambient orders take reefer capacity before another group's chilled orders. That breaks the lexicographic policy (ADR 0009).
- Stage 7 asks for a "bounded, deterministic local search" without naming its moves.
- [deferral-explanation.md](../spec/rules-core/deferral-explanation.md) lists the cause kinds and reason codes but not how a binding constraint maps to them.

## Decision

1. **Class 4** is a Style/Tech order whose outlet has gone at least `staleServiceDays` without service. This is a new config key, default 7, matching Style's weekly rhythm. Class 5 is the rest. Inside classes 1 to 4: aging guard, then deferred yesterday, then most days since served. Inside class 5: aging guard, then larger slip. In every class the tie-break is larger volume, then order id. `rankOrders(orders, cfg, { date, calendar })` takes the date and calendar because slip needs them.
2. **Placement in global rank order.** Each order is placed in turn, highest priority first, into a trip of its (brand, district) group. Candidates, best first:
   - **Join:** an open trip of the group, tightest volume fit first. The vehicle's two trips may also swap order, since trip order is free and windows can need it.
   - **New trip:** on the vehicle that wastes the least scarce capability (a reefer for an ambient order, a van for an outlet that is not van-only), then the smallest vehicle that holds the group's remaining demand (otherwise the largest), preferring a free second slot.

   Every candidate is checked with `validatePlan` on that vehicle's day, so the output always validates.
3. **Local search.** Rank order is lexicographic, so for a deferred order d only higher-priority orders matter. Lower-priority orders are set aside, and d is placed directly or after one structural move on the higher-priority orders:
   - relocate one order off a trip of d's group
   - move a whole trip to another vehicle
   - dissolve a trip into other trips
   - merge two trips of one group

   The set-aside orders then go back in rank order where they fit. Every accepted move strictly improves the served set in rank order, so the search terminates. `localSearchIterationCap` bounds it. A probe pass then re-inserts any order that still fits, so the result is single-insertion maximal.
4. **Explanations.** Each deferral is explained against the final plan:
   - **Unavoidable, infeasible:** no vehicle at the depot can carry the order, or none can even alone. If only a workshop vehicle could carry it, the reason is `VEHICLE_BREAKDOWN` when every such vehicle broke down, otherwise `VEHICLE_IN_WORKSHOP`.
   - **Unavoidable, pool exhausted:** the order is feasible alone but has no valid slot. The reason is `REEFER_SHORTAGE` for a chilled order and `VAN_SHORTAGE` for a van-only outlet. Otherwise it follows the binding constraint of the best slot. `TRIP_LIMIT_EXCEEDED` maps to `TIME_BUDGET`, because Booklet rule 7 is "trips and time". `displacedBy` lists up to five equal or higher-priority orders on that slot's vehicle.
   - **Choice:** a valid slot exists, as when the dispatcher defers an order by hand. The reason is `MOVED_BY_POLICY` for Style/Tech and `OTHER` (note required) for Fresh.
5. **Claim.** The allocator agrees with a brute force of the same lexicographic objective on tiny instances (up to 4 orders on up to 3 vehicles: 0 mismatches in 3,000 random instances). It is a bounded search, not an exact solver. At 5 orders on 2 vehicles, 1 instance in 3,000 needs a two-step rearrangement it does not find.

## Alternatives considered

- Pack each group whole (stage 5 as written): breaks chilled-first across groups.
- A weighted score or a MIP solver: hard to explain, and the solver is deferred (ADR 0014).
- Local search without setting aside lower-priority orders: missed rearrangements that only higher-priority orders constrain (found by the brute-force property).

## Consequences

- Spec edited: `spec/domain/priority-policy.md`, `spec/rules-core/allocator.md`, `spec/rules-core/deferral-explanation.md`, `spec/rules-core/config.md`, `spec/rules-core/api-surface.md`.
- A peak-day-sized input (86 orders, full fleet, 17 vehicles in the workshop) proposes in well under 2 s.
