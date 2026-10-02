---
status: draft
owner: Dinura
sources: guide §17
---

# Optimization sidecar

> **STATUS (ADR 0014).** The optimisation sidecar is **not built for now**. The greedy allocator in `packages/rules` is the only engine and `SOLVER_ENABLED` is `false`. The design below stays valid so it can be built later if time remains after the walkthrough passes. Nothing else in the system may depend on it.

**Role**: improve assignment quality (fewer deferrals, better packing) on request. It proposes assignments only; it never decides validity.

**Contract**: `POST {SOLVER_URL}/solve` with `{ orders, vehicles, reference subset, config, warmStart (greedy plan), timeLimitMs }` and response `{ status, objective, assignments: [{ orderId, vehicleId, tripNo }], stats }`; `GET /health`. Stateless; deterministic given a fixed seed and single worker.

**Model (OR-Tools CP-SAT)**: boolean `x[order, vehicle, tripNo]` and trip-activation `y[vehicle, tripNo, brand, district]`. Constraints: each order at most once; link `x <= y`; one brand/district per trip; weight and volume capacity; reefer/van/depot eligibility (pre-filtered); at most 2 trips per vehicle; class time budgets, linear in `x` and `y` (`time = outbound*y + interStop*(sum x - y) + sum(service*x)`); weekly fuel. Window feasibility is checked after solving by the rules core. Objective (lexicographic via weights): maximize priority-weighted served orders, then minimize trips, then minimize km.

**Gate**: the API converts the response to a draft and runs `validatePlan`. Only a plan that passes is offered; otherwise the greedy plan stays. Property tests assert that no solver output ever passes through unvalidated. The UI MAY show a quality readout ("heuristic served N, optimiser served N+k").

**Operations**: Compose profile `solver`; Python image with `ortools`; request time limit default 10 s; `app` treats timeouts and errors as "no suggestion".
