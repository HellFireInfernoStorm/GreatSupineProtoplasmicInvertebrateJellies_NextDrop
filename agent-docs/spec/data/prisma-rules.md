---
status: draft
owner: Dinura
sources: guide §6.3
---

# Prisma usage rules

## 6.3 Prisma usage rules (known pitfalls)

- **BigInt** (`ChangeFeed.seq`) does not JSON-serialize: convert to string at the API boundary.
- **Decimal(10,3)** for reference capacities/demand; **Decimal(13,6)** for Product and OrderLine unit sizes. Aggregate exact saved unit sizes before ceiling final order totals once to integer grams/litres using `aggregateOrderQuantities` from `packages/rules` (ADR 0023). Reference converters remain unchanged.
- **Locks**: use tagged `$queryRaw` for `SELECT ... FOR UPDATE` and `pg_advisory_xact_lock(hashtextextended(...))`. Never build SQL by string concatenation.
- **A failed statement aborts a Postgres transaction** and Prisma does not add savepoints. Therefore: ingest each field event in its **own short transaction**; detect duplicates with a pre-check plus `createMany({ skipDuplicates: true })` (ON CONFLICT DO NOTHING) and re-read, never by catching a unique violation inside a larger transaction.
- Set explicit `maxWait`/`timeout` on interactive transactions; keep them short; do JSON-heavy reads outside the transaction.
- Container: Debian-slim base (not Alpine); Prisma/client/adapter pinned to 7.10.0, pg to 8.23.1. Prisma 7 uses `prisma.config.ts`, the `prisma-client` TypeScript generator and `PrismaPg`; no native client engine or `binaryTargets` is used. Run `prisma generate` explicitly at build and `prisma migrate deploy` at start (neither migration command generates the client). Ship the migration files with the API for readiness checks. Generate output is ignored and must not be committed.
- Seed: `apps/api/prisma/seed/` TypeScript, idempotent (upserts keyed by natural IDs), safe to run on every start.
- **Raw SQL drift check**: verified on 2026-10-03 with Prisma 7.10.0 and PostgreSQL 16.15 in issue #25 (ADR 0023). Re-run on the final initial migration as merged (fresh databases, same commands as below). Two consecutive `migrate dev` runs succeeded (first applied it, second reported already in sync). `migrate deploy` on a separate clean database succeeded. No drift workaround is required. The migration's hand-written triggers and CHECKs survive replay/comparison; its partial unique index is also represented in the schema with `partialIndexes`.

## Reproducing the first migration verification

Run from the repository root. These credentials belong only to the disposable local test container. The names/port below isolate this task from other stacks. If the named container/databases already exist, reuse them; do not reset an existing database to repeat the check. Use fresh names when changing an unapplied initial migration.

```sh
pnpm install --frozen-lockfile
docker run --name nextdrop-25-postgres \
  -e POSTGRES_USER=nextdrop -e POSTGRES_PASSWORD=nextdrop \
  -e POSTGRES_DB=nextdrop_25 -p 127.0.0.1:55425:5432 -d postgres:16
docker exec nextdrop-25-postgres pg_isready -U nextdrop
docker exec nextdrop-25-postgres psql -U nextdrop -d postgres \
  -c 'CREATE DATABASE nextdrop_25_review_verify' \
  -c 'CREATE DATABASE nextdrop_25_review_shadow' \
  -c 'CREATE DATABASE nextdrop_25_review_clean' \
  -c 'CREATE DATABASE nextdrop_25_review_test'

export DATABASE_URL=postgresql://nextdrop:nextdrop@127.0.0.1:55425/nextdrop_25_review_verify
export SHADOW_DATABASE_URL=postgresql://nextdrop:nextdrop@127.0.0.1:55425/nextdrop_25_review_shadow
pnpm --filter @nextdrop/api exec prisma validate
pnpm --filter @nextdrop/api exec prisma generate
pnpm --filter @nextdrop/api exec prisma migrate dev
pnpm --filter @nextdrop/api exec prisma migrate dev
DATABASE_URL=postgresql://nextdrop:nextdrop@127.0.0.1:55425/nextdrop_25_review_clean \
  pnpm --filter @nextdrop/api exec prisma migrate deploy
TEST_DATABASE_URL=postgresql://nextdrop:nextdrop@127.0.0.1:55425/nextdrop_25_review_test \
  pnpm test:int

docker exec nextdrop-25-postgres psql -U nextdrop -d nextdrop_25_review_verify \
  -c "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%immutable'" \
  -c "SELECT count(*) FROM pg_constraint WHERE contype='c' AND connamespace='public'::regnamespace" \
  -c "SELECT indexdef FROM pg_indexes WHERE indexname='trip_stops_active_order_key'" \
  -c 'SELECT singleton, head FROM feed_counter'
```

Observed after the second migration run: 3 immutability triggers, 30 CHECK constraints, the partial unique order index with its non-cancelled predicate, and exactly one FeedCounter at head 0. The separate clean-deploy and integration databases contain the same safeguards. The integration suite deploys migrations automatically to TEST_DATABASE_URL and requires a disposable database name ending in `_test`; it does not run a reset or reference/application seed. Normal unit tests require no database. Every configured integration run creates a uniquely named schema, deploys migrations into it and drops that schema in teardown, including committed concurrency fixtures. With TEST_DATABASE_URL absent the suite skips with a clear message; a configured unsafe URL still fails.

Development/shadow/test URLs must identify separate databases. Do not point SHADOW_DATABASE_URL at the application database: Prisma owns and recreates shadow state. During initial development an earlier applied draft was left intact; final verification used a fresh database instead of bypassing Prisma's reset-consent guard.

Any database that applied an earlier draft of the initial migration has a different checksum and must be recreated; readiness reports it as unavailable. Production startup runs only the already-generated client; tsx is a runtime dependency and prisma is a build/migration devDependency. API package files explicitly include generated source and migration artifacts.
