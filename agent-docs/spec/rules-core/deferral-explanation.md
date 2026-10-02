---
status: draft
owner: Dinura
sources: guide §5.4
---

# Deferral explanation

## 5.4 Deferral explanation

`DeferralExplanation = { reasonCode, causeKind, bindingConstraint, scoreInputs, displacedBy?, note }`.

- `causeKind = UNAVOIDABLE_INFEASIBLE`: no available vehicle can ever carry it today (no reefer/van available, exceeds every vehicle's capacity, window impossible).
- `UNAVOIDABLE_POOL_EXHAUSTED`: feasible in principle, but the scarce pool (reefer capacity, van time, Fresh budget, fuel) is fully used by equal or higher priority orders.
- `CHOICE`: a feasible slot existed but was used otherwise (dispatcher's manual deferral, or Style/Tech moved a day by policy).

Reason codes (extendable in `contracts`): `CAPACITY_WEIGHT`, `CAPACITY_VOLUME`, `REEFER_SHORTAGE`, `VAN_SHORTAGE`, `TIME_BUDGET`, `FUEL_QUOTA`, `WINDOW_INFEASIBLE`, `VEHICLE_IN_WORKSHOP`, `MOVED_BY_POLICY`, `OTHER` (requires note). `scoreInputs` includes `deferred_yesterday` and `days_since_last_served`. This output feeds the D3 deferral review, store notices, and the Datathon Task 2B write-up.

**Consequence fields** (ADR 0010): `nextServiceableDate` (next operating date after the deferral on which the outlet can be served, from the calendar), `daysUnserved` (days from `requestedDate` to that date) and `consecutiveDeferrals`. They are computed in `packages/rules`, stored on `Deferral`, and used in the store notice ('next delivery Tuesday') and in the D3 deferral review sort.
