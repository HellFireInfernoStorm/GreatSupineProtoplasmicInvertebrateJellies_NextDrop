# Specification

How NextDrop is built. Split by concern from the draft architecture guide so an agent reads only the area it works on. Every topic file has a header (`status: draft | agreed`, `owner`, `sources`). Everything starts as `draft`.

Start with [overview.md](overview.md). Open decisions are in [open-questions.md](open-questions.md). The change rule is in [spec-changes.md](../process/spec-changes.md).

## Areas

| Area | Holds |
| --- | --- |
| [domain/](domain/README.md) | Constraints, trip time, cutoff, priority policy |
| [rules-core/](rules-core/README.md) | `packages/rules`: validator, allocator, reducer |
| [data/](data/README.md) | Prisma model, SQL constraints, seed and demo, judge walkthrough |
| [events/](events/README.md) | Event envelope and catalogue (`packages/contracts`) |
| [planning/](planning/README.md) | Planning flow and publish transaction |
| [sync/](sync/README.md) | Push protocol, change feed, recovery rules, offline client |
| [platform/](platform/README.md) | Stack, API, auth, notifications, testing, deployment, data policy |
| [frontend/](frontend/README.md) | Shells, routes, design system as built |
| [optional/](optional/README.md) | Prediction providers, optimisation sidecar |
| [assumptions.md](assumptions.md) | Configurable defaults |
| [build-order.md](build-order.md) | Build order and definition of done |

## Conventions in the text

MUST means non-negotiable, SHOULD means default unless there is a strong reason, MAY means optional. Every hard-coded assumption belongs in [assumptions.md](assumptions.md) and in config, never scattered in code. The Booklet defines what must be delivered; the spec defines how. If they conflict on a requirement the Booklet wins.

## Old section numbers

The text still refers to sections of the original single-file guide (for example "section 9.5"). Use this table to find them.

| Old section | New file |
| --- | --- |
| §1, §2 | [overview.md](overview.md) |
| §4.1 | [domain/glossary.md](domain/glossary.md) |
| §4.2 | [domain/constraints.md](domain/constraints.md) |
| §4.3-4.5 | [domain/trip-time-and-budgets.md](domain/trip-time-and-budgets.md) |
| §4.6 | [domain/cutoff-and-calendar.md](domain/cutoff-and-calendar.md) |
| §4.7 | [domain/priority-policy.md](domain/priority-policy.md) |
| §4.8 | [domain/units-and-time.md](domain/units-and-time.md) |
| §5, §5.1 | [rules-core/api-surface.md](rules-core/api-surface.md) |
| §5.2 | [rules-core/validator-codes.md](rules-core/validator-codes.md) |
| §5.3 | [rules-core/allocator.md](rules-core/allocator.md) |
| §5.4 | [rules-core/deferral-explanation.md](rules-core/deferral-explanation.md) |
| §5.5 | [rules-core/order-reducer.md](rules-core/order-reducer.md) |
| §5.6 | [rules-core/config.md](rules-core/config.md) |
| §6, §6.1 | [data/model.md](data/model.md) |
| §6.2 | [data/sql-constraints.md](data/sql-constraints.md) |
| §6.3 | [data/prisma-rules.md](data/prisma-rules.md) |
| §15 | [data/seed-and-demo.md](data/seed-and-demo.md) |
| §7, §7.1 | [events/envelope.md](events/envelope.md) |
| §7.2 | [events/catalogue.md](events/catalogue.md) |
| §8, §8.1 | [planning/flow.md](planning/flow.md) |
| §8.2 | [planning/publish-transaction.md](planning/publish-transaction.md) |
| §8.3 | [planning/other-behaviours.md](planning/other-behaviours.md) |
| §9, §9.1-9.2 | [sync/push-protocol.md](sync/push-protocol.md) |
| §9.3 | [sync/blobs.md](sync/blobs.md) |
| §9.4 | [sync/change-feed.md](sync/change-feed.md) |
| §9.5 | [sync/recovery-and-conflicts.md](sync/recovery-and-conflicts.md) |
| §9.6 | [sync/versioning-and-clocks.md](sync/versioning-and-clocks.md) |
| §10 | [sync/offline-client.md](sync/offline-client.md) |
| §3 | [platform/stack-and-layout.md](platform/stack-and-layout.md) |
| §11 | [platform/notifications-and-monitoring.md](platform/notifications-and-monitoring.md) |
| §12 | [platform/api.md](platform/api.md) |
| §13 | [platform/auth.md](platform/auth.md) |
| §18 | [platform/testing.md](platform/testing.md) |
| §19 | [platform/deployment.md](platform/deployment.md) |
| §20 | [platform/data-policy.md](platform/data-policy.md) |
| §14, §14.1 | [frontend/architecture.md](frontend/architecture.md) |
| §14.2 | [frontend/design-system.md](frontend/design-system.md) |
| §16 | [optional/providers.md](optional/providers.md) |
| §17 | [optional/solver.md](optional/solver.md) |
| §21 | [assumptions.md](assumptions.md) |
| §22 | [build-order.md](build-order.md) |
| §1.2, §1.3 | [../brief/requirements-and-scoring.md](../brief/requirements-and-scoring.md) |
| §0, §23 | Replaced by this page, the root `AGENTS.md` and `agent-docs/process/` |
