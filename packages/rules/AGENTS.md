# packages/rules: pure rules core

Read first: [spec/rules-core](../../agent-docs/spec/rules-core/README.md), [spec/domain](../../agent-docs/spec/domain/README.md).

- Pure, deterministic TypeScript. Zero runtime dependencies and no imports from elsewhere in the repo.
- No I/O, no `Date.now()`, no `Math.random()`. A seeded PRNG is allowed in local search.
- Integers only: weight in grams, volume in litres, time in minutes since local midnight.
- Every planning path (auto, assisted, manual edit, solver output, tests) goes through this package. The browser bundles the same code.
- Each validator code has a unit test. `proposePlan` output must always pass `validatePlan` (property test).
- Keep the Booklet's worked trip-time examples (101, 112 and 213 of 270 minutes) as tests.
- Validity uses the free-flow trip-time formula only. Traffic and road conditions affect displayed ETAs and risk, never validity.
