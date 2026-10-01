---
status: draft
owner: Dinura
sources: guide §6.3
---

# Prisma usage rules

## 6.3 Prisma usage rules (known pitfalls)

- **BigInt** (`ChangeFeed.seq`) does not JSON-serialize: convert to string at the API boundary.
- **Decimal(10,3)** for weights/volumes; convert to integer grams/litres when crossing into `rules`.
- **Locks**: use tagged `$queryRaw` for `SELECT ... FOR UPDATE` and `pg_advisory_xact_lock(hashtextextended(...))`. Never build SQL by string concatenation.
- **A failed statement aborts a Postgres transaction** and Prisma does not add savepoints. Therefore: ingest each field event in its **own short transaction**; detect duplicates with a pre-check plus `createMany({ skipDuplicates: true })` (ON CONFLICT DO NOTHING) and re-read, never by catching a unique violation inside a larger transaction.
- Set explicit `maxWait`/`timeout` on interactive transactions; keep them short; do JSON-heavy reads outside the transaction.
- Container: Debian-slim base (not Alpine); `binaryTargets` includes the runtime target; `prisma generate` at build; `prisma migrate deploy` at start; follow the pinned Prisma major's config-file and driver conventions.
- Seed: `apps/api/prisma/seed/` TypeScript, idempotent (upserts keyed by natural IDs), safe to run on every start.
