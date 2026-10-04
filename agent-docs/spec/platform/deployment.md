---
status: draft
owner: Dinura
sources: guide §19
---

# Deployment and operations

- **Local/judge path**: `docker compose up` -> `db` healthy -> `app` runs `prisma migrate deploy`, seeds, serves API + PWA on one port: http://localhost:8080 (`APP_PORT`; 8080 so it does not collide with `pnpm dev` on 3000 and 5173). Every variable has a working default, so no `.env` is needed. The database is not published to the host. An empty `SESSION_SECRET` makes the container generate one on first start and keep it in the `app-data` volume. `localhost` counts as a secure context, so the service worker works without TLS.
- **Hosting provider** (ADR 0051):
  - One DigitalOcean droplet: Basic, 2 GB RAM, 1 shared vCPU, region SGP1, Ubuntu 24.04, on Dinura's account.
  - The public URL is https://146.190.92.202.sslip.io. sslip.io maps the name to the droplet's IP, so no domain is needed.
  - A DigitalOcean Cloud Firewall allows only 22, 80 and 443 inbound. Docker bypasses `ufw`, and `app` publishes 8080.
- **Public path**: the droplet runs Compose with the `public` profile (Caddy, automatic HTTPS). The deployment MUST stay live through the review, semifinal and Grand Finale periods. `DEMO_MODE=true` there so judges can reset the day.
  - **First boot:** `docker/droplet-init.sh` is the droplet's user-data script. It adds 2 GB of swap (so the image builds in 2 GB of RAM), installs Docker and clones the repository to `/opt/nextdrop`. Then it writes `.env` with `COMPOSE_PROFILES=public`, `CADDY_DOMAIN`, `PUBLIC_ORIGIN`, generated `SESSION_SECRET`, `DEMO_SCRIPT_KEY` and `POSTGRES_PASSWORD`, `DEMO_MODE=true` and `TZ`, and runs `docker compose up -d --build`.
  - **Redeploy:** in `/opt/nextdrop`, run `git pull && docker compose up -d --build`. The seed is idempotent (ADR 0030), so the demo state survives.
  - **Logs:** `docker compose logs -f app`.
  - **Backup:** `docker compose exec -T db pg_dump -U nextdrop nextdrop | gzip > backup.sql.gz`.
  - **Caddy needs no Caddyfile.** `caddy reverse-proxy` flushes `text/event-stream` at once, so SSE is not buffered. The app sets the cache headers itself.
- **Demo mode has a build-time half**: the server reads `DEMO_MODE` when it starts, but the quick-login chips on the login screens are compiled into the web app by `VITE_DEMO_MODE` (ADR 0031). Compose passes `DEMO_MODE` to the image build as that argument, default `true`, so one variable sets both. Changing `DEMO_MODE` therefore needs a rebuild (`docker compose up --build`); a restart alone changes the server and leaves the chips as they were built. With the flag off, the demo accounts and their credentials are not in the bundle.
- **Static serving** from `app` (`WEB_DIST_DIR`): `index.html` and `sw.js` `no-store`; hashed `assets/*` immutable; other files `no-cache`; SPA fallback (a GET outside `/api` with no matching file gets `index.html`, unknown `/api` paths keep the JSON 404); correct SW scope headers; SSE not buffered by the proxy. Files are served from the not-found path, not as routes, because every route must declare an API policy (ADR 0028).
- **Environment (`.env.example`)**: `APP_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (Compose builds `DATABASE_URL` from them), `DATABASE_URL` (outside Compose), `SESSION_SECRET`, `TZ=Asia/Colombo`, `DEMO_MODE`, optional `DEMO_SCRIPT_KEY`, `FIELD_REAUTH_GRACE_DAYS` (default 30), `SEED_ON_START`, `SOLVER_ENABLED` (false, ADR 0014), `SOLVER_URL`, `PUBLIC_ORIGIN`, `CADDY_DOMAIN`, `VAPID_*` (optional), plus the tunables in section 21 where they are env-driven. DEMO_SCRIPT_KEY supplies the secret for x-nextdrop-script-key; if unset/empty, script-key access is disabled even with DEMO_MODE=true. Dispatcher-session demo access still follows normal policy. FIELD_REAUTH_GRACE_DAYS is a positive integer number of days and sets the post-expiry FIELD renewal/cleanup window in [auth](auth.md). Neither secret belongs in the client bundle or fixtures.
- **Observability**: pino JSON logs with request IDs; `/healthz` (process) and `/readyz` (DB + migrations); in-app sync diagnostics. No separate metrics stack.
- **Scaling note** (documented, not built): single `app` instance; SSE fan-out is in-process; multi-instance would move fan-out to Postgres LISTEN/NOTIFY, which the change feed already supports via cursors.
