---
status: draft
owner: Dinura
sources: guide §22
---

# Build order and definition of done

## 22.1 Dependency-driven build order

1. Monorepo skeleton, Compose (`db` + `app`), CI, `.env.example`, contract v1 (event catalogue, DTOs, status vocabulary, error codes). Deploy this skeleton publicly early and keep it deployed.
2. `packages/rules` with full unit/property tests (validator, trip time, ETA, fuel, allocator, reducer).
3. Prisma schema (first migration includes the raw-SQL drift check in [prisma-rules.md](data/prisma-rules.md)), migrations (with raw SQL), seed (reference, products, accounts, story day).
4. Auth, policy layer, role shells, themes and the shared component kit.
5. Orders module and Store app (cutoff, place order, detail, notifications).
6. Planning module and Dispatcher app (queue, propose, edit with live validation, defer review, publish).
7. Sync module, change feed, SSE, notifications fan-out.
8. Loader and Driver apps on the offline core (Dexie, outbox, service worker, snapshot, blobs, i18n).
9. Monitor (D4), exceptions inbox, conflicts, disputes, fleet, capacity outlook, providers.
10. Demo tools, presets, force-offline, Playwright walkthrough green against the deployed build.
11. README (setup, accounts, numbered walkthrough, departures), `docs/` (architecture diagram, data model/ERD, AI disclosure), demo video.
12. Optional last: Web Push, solver sidecar (section 17), extras.

## 22.2 Definition of done (from the Booklet)

- [x] `docker compose up` on a fresh clone starts DB, migrates, seeds, serves the app.
- [x] Public URL live with four seeded accounts, one per role.
- [x] A judge can complete the walkthrough across all four roles; Driver and Loader work at phone width.
- [x] Plans respect capacity, temperature, access, windows, fuel quotas; demand > capacity day handled; deferrals recorded with reasons.
- [x] Offline operation and reconciliation demonstrated, including a clash.
- [x] README: setup/config, seeded accounts, numbered walkthrough, significant departures from the Designathon design.
- [x] `docs/`: architecture diagram, data model, AI tool disclosure.
- [ ] Demo video (5-8 min): four roles completing the walkthrough, then a brief code and architecture explanation.
- [ ] Nothing pushed after the deadline.
