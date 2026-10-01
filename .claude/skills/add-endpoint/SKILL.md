---
name: add-endpoint
description: Add or change an API endpoint end to end across contracts, api and web. Use for any new route or DTO.
---

Order matters because parallel work depends on contracts:

1. `packages/contracts`: add or change the zod DTO and error codes. Label the issue `contract-change`. Bump `schemaVersion` if an event payload changed.
2. `packages/rules`: if the endpoint enforces or checks a constraint, add it here first with a unit test. Never re-implement a constraint in the API or UI.
3. `apps/api`: add the route inside the owning module, call `can(actor, action, resource)`, return contract DTOs (never Prisma models). Add to the generated role x endpoint authorization matrix test.
4. `apps/web`: add the client call and UI using the contract types.
5. Tests: contract round-trip, API integration, and an e2e step if it is part of the judge walkthrough.
6. Docs: edit `agent-docs/spec/platform/api.md` in the same PR. Add an ADR if this deviates from the spec.

Read `apps/api/AGENTS.md` and `agent-docs/spec/platform/api.md` first.
