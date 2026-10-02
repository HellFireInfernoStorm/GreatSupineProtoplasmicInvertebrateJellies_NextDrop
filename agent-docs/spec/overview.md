---
status: draft
owner: Dinura
sources: guide §1, §2
---

# Overview, principles and containers

One responsive, installable web app (PWA) with four role-based shells over one modular-monolith API and one PostgreSQL database. It connects ordering, planning, loading, delivery and receipt for the customer Waypoint Group (the product is called NextDrop; three brands, 120 outlets, two depots, 60 vehicles).

Core product idea: **one record per order, with a timeline.** Every role reads the same order and appends events to it. The dispatcher's published plan is the source every other role reads.

## 1.1 Roles

| Role | Persona (design) | Device | Connectivity | Key jobs |
| --- | --- | --- | --- | --- |
| Store manager | Dilini, Waypoint Fresh OUT015 (Wellawatte) | Phone + desktop | Online; degrades gracefully | Place orders before 16:00 cutoff, see ETA and deferral notices, confirm receipt, report issues |
| Dispatcher | Nimal, Peliyagoda DC | Desktop (1600x1000) | Stable | Review queue, propose/edit plan, defer with reason codes, publish, monitor live runs, resolve exceptions, capacity outlook |
| Loader | Kasun, night shift, Peliyagoda dock | Shared tablet (landscape 1280x800); MUST also work at phone width | Offline-capable | See trips by departure, load in reverse stop order, flag short/damaged, hold-to-mark-ready |
| Driver | Sampath (walkthrough, Kandy hill run, fixtures per ADR 0008); Ruwan S. (Peliyagoda, extra account) | Personal Android phone (360x800) | Offline-first | One stop per screen, record outcome and proof of delivery, sync when signal returns |

Order statuses shown in every app (one vocabulary): `Ordered, Planned, Deferred, Loaded, Out for delivery, Delivered, Received`, plus `Short` (a loader flag), `Failed`, `Disputed`, `Cancelled`.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CLIENT TIER: One Installable PWA                      │
│          (Vite • React • Tailwind + shadcn/ui • Workbox • Dexie.js)         │
│                                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐  │
│  │Store manager │   │  Dispatcher  │   │    Loader    │   │    Driver    │  │
│  │    light     │   │    light     │   │     dark     │   │     dark     │  │
│  │phone+desktop │   │   desktop    │   │tablet•offline│   │phone, offline│  │
│  └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘  │
│                                                                             │
│         Offline (Loader, Driver): service worker + IndexedDB outbox         │
│       Shared: design tokens • rules core (live checks) • zod contracts      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTPS • event batches
                                       │ /changes cursor • SSE hint
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    APPLICATION TIER: Modular Monolith API                   │
│                  (Node.js • Fastify • TypeScript • Prisma)                  │
│                                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐  │
│  │    Orders    │   │   Planning   │   │     Sync     │   │    Notify    │  │
│  │ 4 PM cutoff  │   │ publish/diff │   │ingest, clash │   │  SSE • push  │  │
│  └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐  │
│  │ Change feed  │   │Auth & policy │   │     Jobs     │   │  Demo tools  │  │
│  │ cursor pull  │   │scoped access │   │pg-boss queue │   │ clock, reset │  │
│  └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │              RULES CORE: packages/rules (pure TypeScript)             │  │
│  │          validator • allocator • trip time • fuel • priority          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────┬─────────────────────────────────────────┬─────────────────┘
                  │                                         │
                  │ State, events, plans      Propose batch │
                  ▼                                         ▼
┌───────────────────────────────────┐     ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
│          DATA PERSISTENCE         │     ╎        OPTIMIZATION SIDECAR       ╎
│          (PostgreSQL 16)          │     ╎    (optional • Compose profile)   ╎
│                                   │     ╎                                   ╎
│      reference CSVs • orders      │     ╎      Python • OR-Tools CP-SAT     ╎
│     order_events (append-only)    │     ╎     proposes assignments only;    ╎
│      immutable plan versions      │     ╎    rules core validates output    ╎
│      conflicts • change feed      │     ╎    greedy plan is the fallback    ╎
│        notifications • jobs       │     ╎                                   ╎
└───────────────────────────────────┘     └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
```

## 2.1 Principles

1. **One implementation of every rule.** All planning paths (auto, assisted, manual edit, solver output, tests) go through `packages/rules`. The browser bundles the same package for instant dispatcher feedback; the server is authoritative.
2. **The order is an event-logged object.** `order_events` is append-only. `orders.status` is a projection updated by the same pure reducer, in the same transaction.
3. **Field work is intent events.** Driver and loader actions are facts ("delivered 12 crates at 06:12 under plan v3"), queued on-device, ingested idempotently, reconciled by explicit rules. Never whole-row snapshots.
4. **Clashes use plan versions, not device clocks.** Device times are displayed, never used to decide anything.
5. **Humans resolve true clashes.** Nothing is auto-resolved when a driver's fact contradicts a plan change.
6. **Pull is the source of truth for change delivery.** A monotonic change feed with cursors; SSE is only a "something changed" hint with polling fallback.
7. **Server owns time.** Cutoffs, countdowns and ETAs use a server clock (with demo override); all instants stored UTC, displayed Asia/Colombo.

## 2.2 Containers (Docker Compose)

| Service | Image / build | Role | Notes |
| --- | --- | --- | --- |
| `db` | `postgres:16` | System of record | Healthcheck; named volume |
| `app` | Multi-stage Node build (Debian slim, not Alpine) | Fastify API + serves built PWA (`@fastify/static`, SPA fallback) | Runs `prisma migrate deploy`, idempotent seed, then server. One origin, no CORS |
| `solver` | Python image | Optional CP-SAT sidecar | Compose profile `solver`; absent by default |
| `caddy` | `caddy:2` | TLS for the public deployment | Compose profile `public`; localhost needs no TLS (secure context) |
