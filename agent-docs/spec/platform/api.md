---
status: draft
owner: Dinura
sources: guide §12
---

# API surface

Base path `/api`. JSON, zod-validated, errors as `{ code, message_key, params, requestId }`. Cookie sessions (httpOnly, SameSite=Lax) plus a required custom header on mutations. Field roles mutate only through `/sync/*`.

Schemas, route registration metadata and exported mock fixtures live in `packages/contracts`. The [wire DTO draft](api-dtos.md) records the accepted field names, headers, nullable values, response statuses and binary/SSE boundaries for #29, under ADR 0024. Stored event payloads are unchanged.

| Area | Endpoints | Roles |
| --- | --- | --- |
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/reauth` | all |
| Reference | `GET /ref/{outlets,vehicles,products,calendar,reasons}` | all (scoped) |
| Store | `GET /store/cutoff`, `GET /store/deliveries`, `POST /store/orders` (idempotency key), `GET /store/orders`, `GET /store/orders/:id`, `POST /store/orders/:id/cancel`, `POST /store/orders/:id/receipt`, `POST /store/orders/:id/issues`, `GET /store/notifications`, `POST /store/notifications/read` | store |
| Dispatch | `GET /dispatch/days/:date` (state, queue, demand vs capacity), `POST .../propose`, `GET/PUT .../draft`, `POST .../validate`, `POST .../publish`, `GET .../versions`, `GET /dispatch/runs`, `GET /dispatch/exceptions`, `POST /dispatch/conflicts/:id/resolve`, `POST /dispatch/issues/:id/resolve`, `POST /dispatch/orders/:id/shorts/:lineId/resolve`, `POST /dispatch/orders/:id/reversal`, `GET/PUT /dispatch/fleet`, `GET /dispatch/outlook`, `GET /dispatch/outlets/:id/history` | dispatcher |
| Field | `GET /field/snapshot`, `POST /sync/events`, `PUT /sync/blobs/:id`, `POST /sync/heartbeat`, `POST /sync/conflicts` (optional `includeContext`; ADRs 0043, 0044; [context recovery](../sync/recovery-and-conflicts.md#historical-field-conflict-context-adr-0044)) | loader, driver |
| Blobs | `GET /blobs/:id` (bytes) | depot dispatcher, outlet store, uploader (ADR 0035) |
| Feed | `GET /changes`, `GET /stream` (SSE) | all (audience-filtered) |
| Notifications | `GET /notifications`, `POST /notifications/read` | all |
| Demo (only when `DEMO_MODE=true`) | `GET /demo/state`, `POST /demo/clock`, `POST /demo/reset` (preset), `POST /demo/tick` | dispatcher (+ script key) |
| Ops | `GET /healthz`, `GET /readyz` | public |

`/api/readyz` returns `{ status, checks: { database, migrations } }`: 200 with `status: ok` only when a DB query succeeds and all migration files shipped with the app have completed matching-checksum entries in `_prisma_migrations`. Missing runtime migration files, failed/pending migrations and unavailable/unconfigured databases return 503 with `status: unavailable`. Rolled-back attempts do not count as applied. `/api/healthz` reports process liveness independently. The production image must include `apps/api/prisma/migrations` alongside the API source (ADR 0023).

The lifecycle-managed application Prisma client is available as app.prisma without a readiness query-time limit. A private probe client applies 2s connection/query/statement limits only to readiness checks. Its migration query explicitly uses the configured database schema, independent of the connection's default search path. Closing the server disconnects both clients.
