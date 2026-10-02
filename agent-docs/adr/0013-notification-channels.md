# ADR 0013: No SMS; Web Push optional

- Status: accepted
- Date: 2026-10-02
- Issue / PR: owner decision (Dinura), see the PR that adds this file
- Designathon departure: no

## Context

The degradation design left an SMS backup undecided. An SMS provider is an outside service with cost, number handling and deployment work.

## Decision

Notifications are in-app (feed and SSE) only. There is no SMS channel and no SMS stub. Web Push stays optional and is attempted only after the full walkthrough passes end to end.

## Alternatives considered

- SMS provider: too complex to deploy for this build.
- Web Push now: permission flows and iOS limits for little judged value.

## Consequences

Spec edited: `platform/notifications-and-monitoring.md`, `platform/deployment.md`; note added to `design/degradation-scenario.md`.
