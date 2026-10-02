---
status: draft
owner: Dinura
sources: guide §19
---

# Deployment and operations

- **Local/judge path**: `docker compose up` -> `db` healthy -> `app` runs `prisma migrate deploy`, seeds, serves API + PWA on one port. `localhost` counts as a secure context, so the service worker works without TLS.
- **Hosting provider**: not chosen yet (open question C3). The notes below apply to whichever host is used.
- **Public path**: a small VPS (or equivalent that does not sleep or expire) running Compose with the `public` profile (Caddy, automatic HTTPS). The deployment MUST stay live through the review, semifinal and Grand Finale periods; avoid free tiers that sleep or delete databases. `DEMO_MODE=true` there so judges can reset the day.
- **Static serving** from `app`: `index.html` and `sw.js` never cached; hashed assets immutable; SPA fallback; correct SW scope headers; SSE not buffered by the proxy.
- **Environment (`.env.example`)**: `DATABASE_URL`, `SESSION_SECRET`, `TZ=Asia/Colombo`, `DEMO_MODE`, `SEED_ON_START`, `SOLVER_ENABLED` (false, ADR 0014), `SOLVER_URL`, `PUBLIC_ORIGIN`, `CADDY_DOMAIN`, `VAPID_*` (optional), plus the tunables in section 21 where they are env-driven.
- **Observability**: pino JSON logs with request IDs; `/healthz` (process) and `/readyz` (DB + migrations); in-app sync diagnostics. No separate metrics stack.
- **Scaling note** (documented, not built): single `app` instance; SSE fan-out is in-process; multi-instance would move fan-out to Postgres LISTEN/NOTIFY, which the change feed already supports via cursors.
