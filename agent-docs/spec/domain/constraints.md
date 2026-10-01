---
status: draft
owner: Dinura
sources: guide §4.2
---

# Hard constraints

## 4.2 Hard constraints (validator codes in section 5.2)

1. A trip's orders share one brand and one district.
2. `chilled` orders require a vehicle with `temp = reefer`; reefers may also carry ambient.
3. Outlets with `parking_constraint = van_only` require `type = van`.
4. A vehicle serves only outlets of its own depot.
5. Whole orders: one order on exactly one trip of one vehicle.
6. Per trip: total weight <= `weight_cap_kg` and total volume <= `volume_cap_m3`.
7. At most 2 trips per vehicle per day; per-class time budgets hold (4.3).
8. Delivery must fall inside the outlet's window; mall outlets (`mall_dock`) only inside `mall_window` (effective window = intersection).
9. Delivery date must be an operating day (`calendar.csv is_operating = 1`; Mon-Sat).
10. Weekly fuel use per vehicle <= `weekly_fuel_quota_l` (ISO week).
11. Vehicles in `in_workshop` status cannot be used.
12. Only confirmed orders (past cutoff) for that planning day are plannable.
