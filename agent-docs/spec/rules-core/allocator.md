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
5. **Build trips**: for each group in priority order, pack orders into trips by weight and volume (first-fit-decreasing within a priority band). Assign scarce vehicles first (vans for `van_only`, reefers for chilled), then best-fit by capacity. Respect 2 trips/vehicle, class time budgets and fuel.
6. **Sequence and ETA**: sort stops by window close, compute ETAs, check windows/mall windows. Orders that break a window are removed from the trip and re-queued.
7. **Improve**: bounded, deterministic local search (relocate/swap) to serve more or higher-priority orders.
8. **Probe and explain**: try to insert every deferred order into the final plan. The first failing rule is the binding constraint. If insertion succeeds, the pass was not maximal and continues. The claim is limited to single-order insertions: no single deferred order can be added to the final plan without breaking a hard constraint. Pack-then-assign does not claim global optimality.
9. **Output**: trips, deferrals with explanations, stats (served count, volume by class, pool utilization), and a human-readable trace.
