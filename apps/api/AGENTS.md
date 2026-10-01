# apps/api: Fastify modular monolith

Read first: [spec/planning](../../agent-docs/spec/planning/README.md), [spec/sync](../../agent-docs/spec/sync/README.md), [spec/events](../../agent-docs/spec/events/README.md), [spec/data](../../agent-docs/spec/data/README.md), [spec/platform](../../agent-docs/spec/platform/README.md).

- TypeScript strict. Modules live in `src/modules/<name>/` and talk to each other only through that module's `index.ts`. No deep imports.
- Prisma models never cross the HTTP boundary. Return DTOs from `packages/contracts`.
- Constraints and priorities come from `packages/rules`. Never re-implement them here; the server is authoritative and re-validates every plan.
- Field events (driver, loader) are ingested one per short transaction. Detect duplicates with a pre-check and `createMany({ skipDuplicates: true })`, never by catching a unique violation inside a larger transaction. See [prisma-rules.md](../../agent-docs/spec/data/prisma-rules.md).
- Allocate change-feed sequence numbers as the last statements of a writing transaction.
- Every route declares `{ action, resourceResolver }` and calls `can(actor, action, resource)`. Deny by default. Build list queries with the `scoped(actor)` helper.
- `ChangeFeed.seq` is a BigInt: convert to string at the API boundary.
- Raw SQL (locks, triggers, partial indexes) goes in migrations or tagged `$queryRaw`, never string concatenation.
- Schema or migration changes need the label `schema-change` and an owner review. See [collisions.md](../../agent-docs/process/collisions.md).
