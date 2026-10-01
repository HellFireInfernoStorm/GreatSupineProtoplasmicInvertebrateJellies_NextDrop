# packages/contracts: zod contracts shared by web and API

Read first: [spec/events](../../agent-docs/spec/events/README.md).

- Source of truth for API DTOs, the event envelope and catalogue, error codes, feed kinds and the status vocabulary. Change here first, then the code that uses it.
- Single maintainer reviews every change. Label the issue and PR `contract-change`.
- Bump `schemaVersion` when an event payload changes, and add an upcaster so older clients stay readable.
- May import types from `packages/rules`. Must not import from `apps/*`.
- Contract changes merge before the issues that depend on them. Dependent issues list them under "Blocked by".
