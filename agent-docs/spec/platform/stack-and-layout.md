---
status: draft
owner: Dinura
sources: guide §3
---

# Technology stack, repository layout and dependency rules

## 3.1 Stack

| Concern | Choice |
| --- | --- |
| Language | TypeScript (strict) everywhere except the optional solver (Python) |
| Monorepo | pnpm workspaces, Node 22 LTS |
| Web | Vite, React, React Router, TanStack Query, Tailwind, shadcn/ui (Radix), react-hook-form, Zustand for small UI state |
| PWA and offline | `vite-plugin-pwa` (Workbox), Dexie.js (IndexedDB), `dexie-react-hooks` |
| i18n | `react-i18next`, locales `en`, `si`, `ta` (Loader and Driver; self-hosted Noto Sans Sinhala/Tamil fonts) |
| API | Fastify, `fastify-type-provider-zod`, pino logging, `@fastify/rate-limit`, `@fastify/helmet` |
| ORM | **Prisma** (pin the version; follow the pinned major's config and driver conventions) |
| Validation and contracts | zod schemas in `packages/contracts` shared by web and API |
| Jobs | `pg-boss` (Postgres-backed) |
| Dates | Luxon (Asia/Colombo); rules core uses tz-free minutes-since-midnight |
| IDs | UUID v7 for events/blobs (`uuidv7`); human display IDs (`OUT015`, `VEH001`, `T001`, `ORD10412`) |
| Tests | Vitest, fast-check, Playwright, axe, Testcontainers (or CI service Postgres) |
| Hashing | argon2 |
| Charts | Recharts (or lightweight SVG) for the capacity outlook |

## 3.2 Layout

```
/
├─ apps/
│  ├─ web/                 Vite PWA
│  │   └─ src/ roles/{store,dispatcher,loader,driver}/  ui/  sync/  i18n/  theme/  lib/
│  └─ api/                 Fastify modular monolith
│      ├─ prisma/          schema.prisma, migrations/ (incl. raw SQL), seed/
│      └─ src/ modules/{orders,planning,sync,feed,notify,auth,jobs,demo,monitor,providers}/
│              policy/  lib/  server.ts
├─ packages/
│  ├─ rules/               pure TS, zero runtime deps: validator, allocator, trip time, fuel, reducer
│  ├─ contracts/           zod: API DTOs, event envelope + catalogue, error codes, feed kinds, upcasters
│  └─ config/              tsconfig / eslint / prettier presets
├─ solver/                 optional Python CP-SAT sidecar (section 17)
├─ e2e/                    Playwright walkthrough and offline tests
├─ data/reference/         shared CSVs used for seeding (see section 20)
├─ docs/                   submission docs: architecture diagram, data model, AI disclosure
├─ docker-compose.yml  .env.example  README.md  AGENTS.md
```

## 3.3 Dependency rules (enforced in CI with dependency-cruiser)

- `packages/rules` imports nothing from the repo and has zero runtime dependencies.
- `packages/contracts` may import from `rules` (types, and shared constants such as `PRIORITY_CLASSES` that its zod schemas reuse), and from nothing else in the repo.
- `apps/web` and `apps/api` may import `rules` and `contracts`; they MUST NOT import each other.
- `apps/web` MUST NOT import Prisma or anything under `apps/api`.
- Inside `apps/api`, modules talk through each module's `index.ts` only (no deep imports). Prisma models never cross the HTTP boundary; DTOs from `contracts` do.
