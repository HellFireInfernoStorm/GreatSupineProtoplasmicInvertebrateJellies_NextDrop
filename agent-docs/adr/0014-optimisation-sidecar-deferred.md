# ADR 0014: Optimisation sidecar deferred

- Status: accepted
- Date: 2026-10-02
- Issue / PR: owner decision (Dinura), see the PR that adds this file
- Designathon departure: no

## Context

The sidecar is optional in the spec. A Python container with OR-Tools is a new service.

## Decision

The sidecar is not built now. The greedy allocator in `packages/rules` is the only engine. `SOLVER_ENABLED` is `false`. The team may revisit it if time remains after the walkthrough; building it then needs no new decision because the gate (`validatePlan`) is already specified.

## Alternatives considered

- Build it now: second runtime to build, host and test.

## Consequences

Spec edited: `optional/solver.md`, `platform/deployment.md`.
