# Architecture

NextDrop is one installable web app (PWA) with four role shells, over one modular-monolith API and one PostgreSQL database. The design source is `agent-docs/spec/overview.md`. This page is the submission summary.

## Containers and components

```mermaid
flowchart TB
  subgraph Client["Client tier: one installable PWA (apps/web)"]
    direction LR
    Store["Store manager<br/>phone + desktop"]
    Disp["Dispatcher<br/>desktop"]
    Load["Loader<br/>tablet + phone, offline"]
    Drv["Driver<br/>phone, offline-first"]
    Offline["Offline core<br/>service worker · IndexedDB outbox"]
    Load --- Offline
    Drv --- Offline
  end

  subgraph App["Application tier: modular monolith (apps/api, Fastify)"]
    direction LR
    Orders["orders<br/>16:00 cutoff"]
    Planning["planning<br/>propose · validate · publish"]
    Sync["sync<br/>idempotent ingest · clashes"]
    Feed["feed<br/>change feed cursor"]
    Notify["notify<br/>SSE hint"]
    Auth["auth<br/>sessions · policy"]
    Jobs["jobs<br/>pg-boss"]
    Demo["demo<br/>clock · reset"]
    Monitor["monitor<br/>runs · exceptions"]
  end

  Rules["packages/rules (pure TypeScript)<br/>validator · allocator · trip time · ETA · fuel · priority · order reducer"]
  Contracts["packages/contracts (zod)<br/>API DTOs · event envelope and catalogue · error codes · feed kinds"]

  DB[("PostgreSQL 16<br/>reference data · orders · append-only order_events<br/>immutable plan versions · conflicts · change feed")]

  Client -- "HTTPS: event batches, /changes cursor pull, SSE hint" --> App
  App -- "state, events, plans" --> DB
  Client -. "live rule checks" .-> Rules
  App -. "authoritative re-validation" .-> Rules
  Client -. DTOs .-> Contracts
  App -. DTOs .-> Contracts
  Contracts -. types .-> Rules
```

`docker-compose.yml` runs one `app` container beside a `db` container (`postgres:16`). The app container applies migrations, seeds, and serves the API and the built PWA from one origin (`@fastify/static`, with client-side routes falling back to `index.html`). An optional `public` profile adds Caddy for TLS. **TODO (#33):** name the host once the public deployment is live.

## How the parts fit

| Concern | Approach |
| --- | --- |
| Rules | Written once in `packages/rules`. The browser bundles it for instant feedback while the dispatcher edits a plan; the server re-validates every plan before publishing. |
| Order lifecycle | Each order has an append-only event log. Its status is a projection computed by the same pure reducer, in the same transaction. |
| Field work offline | Loader and driver actions are intent events ("delivered 12 crates at 06:12 under plan v3"), queued in an IndexedDB outbox and ingested idempotently. |
| Clashes | Detected by plan version, never by device clock. A human resolves every true clash in the dispatcher's exceptions inbox. |
| Change delivery | A monotonic change feed with cursors is the source of truth. SSE only hints that something changed, with polling as the fallback. |
| Time | The server owns time (with a demo clock override). Instants are stored in UTC and shown in Asia/Colombo. |

## Dependency rules

From `agent-docs/spec/platform/stack-and-layout.md` §3.3:

- `packages/rules` imports nothing from the repo and has no runtime dependencies.
- `packages/contracts` may import types and shared constants from `rules`, and nothing else in the repo.
- `apps/web` and `apps/api` may import `rules` and `contracts`, and never each other. `apps/web` never imports Prisma.
- Inside `apps/api`, modules talk only through each module's `index.ts`. Prisma models never cross the HTTP boundary; DTOs from `contracts` do.

dependency-cruiser enforces these rules (`pnpm deps:check`, `.dependency-cruiser.js`) in CI and in the pre-push hook, including web importing api and deep imports between API modules.

## Build status

As of 4 Oct 2026, 17:15. "Built" means merged to `main`. **TODO (before submission):** refresh this table.

| Part | Status |
| --- | --- |
| `packages/rules`: calendar, units, cutoff, trip time, ETA, fuel, validator, ranking, allocator, order reducer | Built, with unit and property tests |
| `packages/contracts`: event envelope and catalogue, API DTOs, route table | Built (v1; `LOAD_DAMAGED` is v2 with an upcaster, #114) |
| Database: Prisma schema, first migration with hand-written SQL, readiness check | Built |
| Seed: reference data, seeded accounts, the Peliyagoda peak day, the Kandy story fixtures | Built (#30) |
| API: server, `/api/healthz`, `/api/readyz` | Built |
| API: auth (login, sessions, CSRF, lockout) and policy (`can()`, `scoped()`), with authorization matrix tests | Built (#35, #58) |
| API: store orders (cutoff, place, track, cancel, receipt, issues) and reference data | Built (#42, #110) |
| API: planning (day, propose, draft, validate, fleet), publish and plan versions, dock shortfalls | Built (#45, #48, #51) |
| API: change feed, SSE hint and notifications | Built (#41) |
| API: field snapshot, sync ingest, heartbeat and blob upload | Built (#47, #50) |
| API: sync conflicts (classification, held facts, resolution, outcomes for field devices) | Built (#54, #97, #117) |
| API: run monitor, exceptions inbox and dispute resolution | Built (#59) |
| API: server clock, planning-day tick and demo reset (`before-cutoff` preset) | Built (#38). Other presets and the demo panel: planned (#56) |
| Web: routes, login and the four role shells | Built (#36) |
| Web: shared component kit | Built (#39) |
| Web: offline core (IndexedDB storage, outbox, sync, session recovery) | Built (#40) |
| Web: Store app (place order, my deliveries, tracking, timeline, receipt, issues, history, notifications) | Built (#43, #44) |
| Web: Dispatcher app | Dashboard, order queue and plan board: built (#46). Deferral review and publish (#49), delivery progress and inbox (#61), capacity outlook (#55): planned |
| Web: Loader and Driver apps | Planned (#52, #53) |
| Story fixture picker (`pnpm seed:pick-fixtures`) | Built |
| Docker Compose, Dockerfile, `.env.example` | Built (#31) |
| CI: typecheck, lint, boundaries, unit and integration tests, build, `docker compose up` smoke | Built (#26, #87) |
| Playwright walkthrough test | Planned (#62) |
| Public deployment | Planned (#33, #67) |
