# ADR 0007: Demo reset epoch and visible actor

- Status: accepted
- Date: 2026-10-02
- Issue / PR: owner decision (Dinura), see the PR that adds this file
- Designathon departure: no

## Context

`/demo/reset`, the demo clock and presets change one global database that several judges may use at once, and offline devices keep outboxes written against pre-reset state.

## Decision

`DemoState.resetEpoch` (integer) increments on every reset and seed. It is carried in the field snapshot, the `/changes` response and the SSE hint. A client whose epoch differs clears its outbox and local orders and shows 'Demo data was reset by <role> at <time>'. Reset and clock changes need a confirm step, are rate-limited, and show the actor in a persistent banner. The README tells judges who want isolation to run `docker compose up` locally.

## Alternatives considered

- Banner only: stale outboxes remain a problem.
- Workspace key per judge: every query, the change feed and SSE gain a scope. Too large.

## Consequences

Spec edited: `data/seed-and-demo.md`, `data/model.md`, `sync/change-feed.md`, `sync/offline-client.md`.

Amended 2026-10-03 by [ADR 0030](0030-seed-idempotency-and-reset-epoch.md): the seed increments the epoch only when a run wrote something; a reset always increments it.
