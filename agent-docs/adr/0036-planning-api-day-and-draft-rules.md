# ADR 0036: Planning API: when drafts can be written, and what the day reports

- Status: accepted
- Date: 2026-10-04
- Issue / PR: #45
- Designathon departure: no

## Context

[Planning flow](../spec/planning/flow.md) and [API DTOs](../spec/platform/api-dtos.md) define the day, propose, draft and validate endpoints. Issue #45 builds them. Left open:

- in which planning-day states a draft may be written;
- what the day reports before the tick has created its row;
- what "demand vs capacity" contains, since its contract type is the allocator's `AllocationStats`;
- whether saving a draft with hard violations succeeds.

## Decision

- **Writable states.** Propose and draft saves are allowed once orders are closed: CLOSED, PLANNING, PUBLISHED and IN_PROGRESS. The first draft write moves CLOSED to PLANNING. OPEN and COMPLETE return 409 `ILLEGAL_TRANSITION` with the state. Validate is read-only and works in any state.
- **Day without a row.** `GET day` reports OPEN before the cutoff and CLOSED after it. A draft write creates the row as CLOSED, with `ordersClosedAt` at the cutoff.
- **Demand vs capacity** is the `proposePlan` stats for the current queue and fleet: how much the allocator could serve, before anything is proposed. The call is pure and deterministic.
- **Saving re-validates.** `PUT draft` runs `validatePlan` with the server's own inputs: workshop vehicles, fuel used on other published days of the ISO week, outlets deferred on the last run, and LOADED pins. Any HARD violation is 422 `VALIDATION_FAILED` with the `ValidationResult`; warnings save. Drafts therefore never hold a hard violation, which matches the UI blocking such edits.
- **Queue.** The queue is the depot's orders for the date in a plannable status: ORDERED, PLANNED, DEFERRED, FAILED, LOADED.

## Alternatives considered

- Allow drafts while orders are open: the plan would be built on a queue that can still grow.
- Save invalid drafts and only block publish: the server copy could then disagree with what the UI allows.
- Report demand vs capacity as raw sums without allocating: no "can be served" figure, and the capacity maths would be repeated outside the rules core.

## Consequences

`GET day` costs one allocator run, under 2 s for the peak day. Spec edited: `planning/flow.md` §8.1.
