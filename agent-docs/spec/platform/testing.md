---
status: draft
owner: Dinura
sources: guide §18
---

# Testing and quality

| Layer | Tooling | What it proves |
| --- | --- | --- |
| Rules unit tests | Vitest | Each validator code, trip-time formula (including the Booklet's worked examples: 101 and 112 minutes, 213 of 270), ETA/waiting, fuel, priority ordering |
| Rules property tests | fast-check | Any `proposePlan` output passes `validatePlan`; validator agrees with brute force on tiny instances; allocator is deterministic and maximal (no deferred order can still be inserted) |
| Oracle check | Organisers' `check_allocation.py`, run locally | The allocator's export for the Task 2B scenario passes the official feasibility checks (script and Training/Test data are not committed) |
| Reducer tests | Vitest + fast-check | Transition table, monotonic progress rule, **replay equals stored status** for every order |
| Sync tests | Vitest + Postgres | Idempotency, partial-batch results, each conflict class, held-then-resolved flow, late earlier-stage facts, version-skew upcasting; randomized interleavings of offline batches and plan publishes preserve invariants (no lost events, no auto-resolved clash, convergence) |
| Authorization matrix | generated from route table | Every role x endpoint x ownership combination behaves as declared |
| API integration | Testcontainers / CI service DB | Orders, cutoff, publish transaction, feed gap-freeness |
| Contract tests | zod round-trips | Web and API agree on DTOs and events |
| E2E | Playwright | The full 14-step walkthrough; offline/reconnect/clash using both browser offline mode and force-offline; phone-width runs for Driver and Loader; axe accessibility smoke |
| Structure | dependency-cruiser, ESLint, typecheck | Module boundaries (section 3.3) |
| CI | GitHub Actions | install, typecheck, lint, unit, integration, build, compose smoke test with e2e smoke |
