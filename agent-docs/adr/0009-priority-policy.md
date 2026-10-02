# ADR 0009: Priority order and 'least impact'

- Status: accepted
- Date: 2026-10-02
- Issue / PR: owner decision (Dinura), see the PR that adds this file
- Designathon departure: no

## Context

The draft order put 'deferred yesterday' above chilled Fresh, so a large Style order deferred yesterday outranked every chilled Fresh order, and 'can move a day with least impact' had no computable meaning. The Booklet asks for a written policy and does not prescribe one.

## Decision

Lexicographic order, kept in `RulesConfig.priorityOrder`: (1) chilled Fresh, (2) other Fresh, (3) Style/Tech from outlets deferred on the previous run, (4) most days since last served, (5) remaining Style/Tech. Inside each class: outlets deferred on the previous run first, then most days since served. Aging guard: an order with `deferredCount >= 2` sorts first within its class, never above chilled Fresh. 'Least impact' is the slip `nextServiceableDate - requestedDate`; inside class 5 a larger slip ranks higher, so the smallest-slip orders are deferred first. Tie-break: larger volume, then order ID.

## Alternatives considered

- Keep the draft order: the Style-over-Fresh case remains.
- Weighted score: hard to explain, dispute and test.

## Consequences

Spec edited: `domain/priority-policy.md`, `rules-core/config.md`. Test: snapshot of the ranking on the story day.
