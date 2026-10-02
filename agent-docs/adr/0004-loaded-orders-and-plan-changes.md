# ADR 0004: Loaded orders and later plan changes

- Status: accepted
- Date: 2026-10-02
- Issue / PR: owner decision (Dinura), see the PR that adds this file
- Designathon departure: no

## Context

The transition table had no way out of `LOADED`, yet the loader's 'plan changed' banner implies republishing after loading. An offline `LOAD_CONFIRMED` for an order a later plan version removed would be classified `APPLIED` and then fail as an illegal transition. Goods on a truck are a physical fact and must never be dropped silently.

## Decision

Publish pins `LOADED` orders: removing or moving one is the hard error `ORDER_ALREADY_LOADED` unless a reversal was requested for it. The dispatcher requests a reversal with `LOAD_REVERSAL_REQUESTED`; the loader confirms on the dock with `LOAD_REVERSED`, the only event that moves an order from `LOADED` to `PLANNED` or `DEFERRED`. An offline `LOAD_CONFIRMED` for an order the current plan no longer holds is stored `HELD` as conflict kind `LOAD_AGAINST_CHANGED_PLAN`; the dispatcher keeps it on the truck (re-adds it to the plan) or requests the reversal.

## Alternatives considered

- Freeze loaded orders entirely: the dispatcher cannot fix a wrong plan once loading starts.
- Let the reducer move `LOADED` back freely: any republish can silently invalidate a physical fact.

## Consequences

New events `LOAD_REVERSAL_REQUESTED` and `LOAD_REVERSED`, a validator code, a conflict kind and a reducer exception. Spec edited: `rules-core/order-reducer.md`, `rules-core/validator-codes.md`, `sync/recovery-and-conflicts.md`, `events/catalogue.md`, `planning/publish-transaction.md`.
