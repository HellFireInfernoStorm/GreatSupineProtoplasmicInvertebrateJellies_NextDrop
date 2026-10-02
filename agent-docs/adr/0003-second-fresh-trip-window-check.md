# ADR 0003: Window check for the second Fresh trip

- Status: accepted
- Date: 2026-10-02
- Issue / PR: owner decision (Dinura), see the PR that adds this file
- Designathon departure: no

## Context

`WINDOW_MISSED` is hard, and trip-2 departure in the spec included trip 1's return leg and a reload buffer. The Booklet's Task 2B text says not to add the return journey because the 270-minute Fresh budget already allows for it (its example: 101 + 112 = 213 of 270). The validator could therefore reject double-Fresh plans the Booklet's arithmetic accepts.

## Decision

Two ETAs per stop. The **validation ETA** follows the Booklet formula (no return leg, no reload buffer) and is the only one that can raise a hard `WINDOW_MISSED` or `TIME_BUDGET_EXCEEDED`. The **display ETA** adds trip 1's return leg and the reload buffer. If the display ETA misses a window while the validation ETA does not, the validator emits the warning `LATE_RISK`. `RulesConfig.validationEtaIncludesReturn` (default `false`) switches the validation ETA to the conservative model.

## Alternatives considered

- Keep it hard with return leg: rejects plans the Booklet calls valid.
- Soft window for trip 2 only: makes a Booklet-hard constraint soft.

## Consequences

A property test asserts that a plan accepted by the Booklet formula never produces a hard error. Spec edited: `domain/trip-time-and-budgets.md`, `domain/constraints.md`, `rules-core/validator-codes.md`, `rules-core/config.md`.
