---
name: write-migration
description: Change the Prisma schema or write a migration, including hand-written SQL. Use for any database change.
---

1. Label the issue and PR `schema-change`. Read `agent-docs/spec/data/prisma-rules.md` and `agent-docs/spec/data/sql-constraints.md`.
2. Merge `main` first. If another migration landed since you branched, regenerate yours so ordering is correct.
3. Edit `apps/api/prisma/schema.prisma`, generate the migration, then add hand-written SQL in the same migration folder for things Prisma cannot express: immutability triggers, CHECK constraints, partial unique indexes.
4. Keep weights and volumes as `Decimal(10,3)`; convert to integer grams and litres when crossing into `packages/rules`.
5. Keep seed idempotent (upserts keyed by natural IDs).
6. Verify the migration applies to a clean database and that `migrate dev` does not report drift or drop the hand-written objects.
7. Edit `agent-docs/spec/data/model.md` (and `sql-constraints.md`) in the same PR.
