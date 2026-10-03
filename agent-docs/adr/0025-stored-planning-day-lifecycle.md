# ADR 0025: Store the full planning-day lifecycle

- Status: proposed
- Date: 2026-10-03
- Issue / PR: #79
- Designathon departure: no

## Context

[Cutoff and calendar](../spec/domain/cutoff-and-calendar.md) and the contracts vocabulary define six planning-day states. The initial database migration stores only OPEN and CLOSED, so four valid wire states cannot be persisted. [Planning flow](../spec/planning/flow.md) already has the tick job update stored state; [publication](../spec/planning/publish-transaction.md) checks that state. Issue #79 recommends storing the full lifecycle and asks for an explicit storage choice.

## Decision

Propose storing OPEN, CLOSED, PLANNING, PUBLISHED, IN_PROGRESS and COMPLETE in PlanningDay.state. Add the four missing PostgreSQL enum values through a follow-up migration, preserving existing rows, the OPEN default and the immutable initial migration. The Prisma enum, contracts vocabulary, lifecycle specification and model documentation must agree, with automated drift checks and PostgreSQL persistence coverage.

This corrects storage capability only. Tick, draft, publish, departure and completion transitions stay with their existing implementation issues. Owner acceptance is required before this proposed decision becomes binding.

## Alternatives considered

- Store only OPEN/CLOSED and derive later states: requires new derivation rules across drafts, publications and trips and changes the existing stored-state intent. Not proposed for this fix.
- Rewrite the initial migration: changes already-applied checksums and breaks deployed/readiness compatibility. Use an additive migration instead.

## Consequences

The database can represent every existing planning-day DTO state without changing the contracts or other enums. The same change updates data/model.md and data/sql-constraints.md. Feature writers remain responsible for legal transitions; an enum is not a transition validator. No handlers or data backfill are added.
