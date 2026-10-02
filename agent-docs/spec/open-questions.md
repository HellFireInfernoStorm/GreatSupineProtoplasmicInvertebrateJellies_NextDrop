---
status: draft
owner: Dinura
sources: architecture review of the draft guide, owner decisions of 2026-10-02
---

# Open questions

Unsettled decisions. When one is settled: remove it here, add an ADR, edit the spec file named in its entry (see [spec-changes.md](../process/spec-changes.md)).

Decided on 2026-10-02 and recorded in ADRs 0003 to 0014: second Fresh trip window, loaded orders, shortfall resolution, weekly fuel lock, demo reset epoch, story fixtures and driver, priority policy, presentation conventions, reference-data publication, product name, notification channels, solver deferral. Decided after the Figma review the same day, ADRs 0015 to 0017: the live Figma file is the design source of truth, repository personas win, vehicle breakdowns are built.

## Decisions needed

### C3. Hosting for the public deployment

The Booklet needs a live URL through the review, semifinal and Grand Finale periods. [deployment.md](platform/deployment.md) describes a small VPS with Compose and Caddy and rules out free tiers that sleep or delete databases. The provider and account are not chosen. Decide before the skeleton is deployed (build order step 1). Record it in an ADR and name the host in deployment.md.

## To verify

- **Prisma and raw SQL**: confirm in the first schema PR that `migrate dev` and `migrate deploy` report no drift and do not drop hand-written SQL objects ([prisma-rules.md](data/prisma-rules.md)). Result goes into that file.
- **Story fixtures**: run the fixture picker once the reference CSVs are committed and record the picks ([seed-and-demo.md](data/seed-and-demo.md) 15.5).
- **Native review**: Sinhala and Tamil core vocabulary reviewed by a native speaker ([design-system.md](frontend/design-system.md)).
