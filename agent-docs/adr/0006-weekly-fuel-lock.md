# ADR 0006: Lock scope for the weekly fuel quota

- Status: accepted
- Date: 2026-10-02
- Issue / PR: owner decision (Dinura), see the PR that adds this file
- Designathon departure: no

## Context

The publish lock was per planning day while the fuel quota is per vehicle per ISO week, so two publishes on different days of one week could both pass the check against stale totals.

## Decision

Publish takes `pg_advisory_xact_lock` on `(depot, ISO week)`. The quota check sums fuel from every other published day of that week plus the new plan. A violation carries the affected date in its params.

## Alternatives considered

- Per-day lock: breaks the weekly invariant.
- Per-day locks plus re-validating later days: republish may need to edit an already published day.

## Consequences

Two dispatchers of one depot publishing in the same week queue briefly. Spec edited: `planning/publish-transaction.md`, `domain/trip-time-and-budgets.md`. Test: two concurrent publishes on different days of one week.
