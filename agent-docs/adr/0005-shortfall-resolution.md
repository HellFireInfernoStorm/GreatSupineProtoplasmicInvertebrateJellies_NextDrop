# ADR 0005: Resolving a shortfall at the dock

- Status: accepted
- Date: 2026-10-02
- Issue / PR: owner decision (Dinura), see the PR that adds this file
- Designathon departure: no

## Context

`LOAD_SHORT` notified the dispatcher and store, and `TRIP_READY` required all orders 'resolved', but no event resolved a short and no role owned it.

## Decision

A short is resolved by the dispatcher with `SHORT_RESOLVED { orderId, lineId, outcome, note }`, outcome `SHIP_PARTIAL | HOLD_TRIP | BACKORDER`. The system proposes `SHIP_PARTIAL`; the dispatcher confirms. `TRIP_READY` requires every `LOAD_SHORT` line to have a `SHORT_RESOLVED`. `BACKORDER` creates a new order for the missing quantity through `ORDER_PLACED` with `replacesOrderId`. There is no timer: an unresolved trip shows as 'waiting on dispatcher' in the monitor and the loader's trip list.

## Alternatives considered

- Loader decides: cannot see priority, fuel or the next day's plan, and is not their role in the Booklet.
- Always ship partial automatically: wrong for chilled or windowed goods and leaves no decision record.

## Consequences

Spec edited: `events/catalogue.md`, `planning/other-behaviours.md`.
