---
status: draft
owner: Dinura
sources: guide §12
---

# API surface

Base path `/api`. JSON, zod-validated, errors as `{ code, message_key, params, requestId }`. Cookie sessions (httpOnly, SameSite=Lax) plus a required custom header on mutations. Field roles mutate only through `/sync/*`.

| Area | Endpoints | Roles |
| --- | --- | --- |
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/reauth` | all |
| Reference | `GET /ref/{outlets,vehicles,products,calendar,reasons}` | all (scoped) |
| Store | `GET /store/cutoff`, `GET /store/deliveries`, `POST /store/orders` (idempotency key), `GET /store/orders`, `GET /store/orders/:id`, `POST /store/orders/:id/cancel`, `POST /store/orders/:id/receipt`, `POST /store/orders/:id/issues`, `GET /store/notifications`, `POST /store/notifications/read` | store |
| Dispatch | `GET /dispatch/days/:date` (state, queue, demand vs capacity), `POST .../propose`, `GET/PUT .../draft`, `POST .../validate`, `POST .../publish`, `GET .../versions`, `GET /dispatch/runs`, `GET /dispatch/exceptions`, `POST /dispatch/conflicts/:id/resolve`, `POST /dispatch/issues/:id/resolve`, `GET/PUT /dispatch/fleet`, `GET /dispatch/outlook`, `GET /dispatch/outlets/:id/history` | dispatcher |
| Field | `GET /field/snapshot`, `POST /sync/events`, `PUT /sync/blobs/:id`, `POST /sync/heartbeat` | loader, driver |
| Feed | `GET /changes`, `GET /stream` (SSE) | all (audience-filtered) |
| Notifications | `GET /notifications`, `POST /notifications/read` | all |
| Demo (only when `DEMO_MODE=true`) | `GET /demo/state`, `POST /demo/clock`, `POST /demo/reset` (preset), `POST /demo/tick` | dispatcher (+ script key) |
| Ops | `GET /healthz`, `GET /readyz` | public |
