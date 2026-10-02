---
status: draft
owner: Dinura
sources: guide §5.3
---

# Allocator pipeline

## 5.3 Allocator pipeline (`proposePlan`)

1. **Inputs**: confirmed orders for the planning day, available vehicles (excluding workshop), fuel used this ISO week, outlet service state (`deferred_yesterday`, `days_since_last_served`), reference data, config.
2. **Eligibility** per (order, vehicle): depot, reefer for chilled, van for `van_only`, vehicle available.
3. **Partition** by budget class (Fresh vs Style/Tech), then by (brand, district) groups.
4. **Rank** orders by the priority key (4.7).
5. **Build trips**: place orders one at a time in global rank order (so chilled Fresh of every group goes before any ambient Fresh), each into a trip of its group: join an open trip (tightest fit first; the vehicle's two trips may swap order), else open a new trip on the vehicle that wastes the least scarce capability (reefer, van), then the smallest vehicle holding the group's remaining demand. Every placement is checked with `validatePlan` on that vehicle, so 2 trips/vehicle, class time budgets, windows and fuel always hold (ADR 0022).
6. **Sequence and ETA**: sort stops by window close, compute ETAs, check windows/mall windows. Orders that break a window are removed from the trip and re-queued.
7. **Improve**: bounded, deterministic local search to serve more or higher-priority orders. For a deferred order, lower-priority orders are set aside; it is placed directly or after one move on the higher-priority orders (relocate an order, move a trip to another vehicle, dissolve a trip, merge two trips of a group); then the set-aside orders go back where they fit. Every accepted move improves the served set in rank order (ADR 0022).
8. **Probe and explain**: try to insert every deferred order into the final plan. The first failing rule is the binding constraint. If insertion succeeds, the pass was not maximal and continues. The claim is limited to single-order insertions: no single deferred order can be added to the final plan without breaking a hard constraint. Pack-then-assign does not claim global optimality; it matches a brute force of the same lexicographic objective on tiny instances (up to 4 orders on 3 vehicles, ADR 0022).
9. **Output**: trips, deferrals with explanations, stats (served count, volume by class, pool utilization), and a human-readable trace.
