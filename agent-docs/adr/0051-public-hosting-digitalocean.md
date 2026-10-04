# ADR 0051: Public hosting on a DigitalOcean droplet

- Status: accepted
- Date: 2026-10-04
- Issue / PR: #67, #33
- Designathon departure: no

## Context

The Booklet requires a live public URL that stays up through the review, semifinal and Grand Finale periods. Open question C3 left the provider and account unchosen ([open-questions.md](../spec/open-questions.md), [deployment.md](../spec/platform/deployment.md)).

The stack cannot sleep. The SSE hub runs in the `app` process. The pg-boss tick runs every minute (ADR 0033), so the database is never idle. Blobs live in PostgreSQL (ADR 0035), so no object storage is needed. Splitting the PWA and the API across origins would break the `/api`-scoped `SameSite=Lax` session cookie. The service worker needs HTTPS.

## Decision

Run the existing Compose stack, with the `public` profile, on one DigitalOcean droplet:

- **Droplet:** Basic, 2 GB RAM, 1 shared vCPU, 50 GB disk (about $12 a month), region SGP1, Ubuntu 24.04.
- **Account:** Dinura's account, billed to Dinura's card.
- **Firewall:** a DigitalOcean Cloud Firewall allows only ports 22, 80 and 443 inbound. Docker bypasses `ufw`, and `app` publishes 8080, so the firewall must sit outside the droplet.
- **Address:** the DigitalOcean Reserved IP `137.184.250.211`, assigned to the droplet. It is free while it is assigned, and it stays the same if the droplet is destroyed and recreated.
- **Hostname:** `nextdrop.duckdns.org`, a free DuckDNS name with an A record pointing at the Reserved IP. Caddy gets a Let's Encrypt certificate for it.
- **Public URL:** https://nextdrop.duckdns.org

`docker/droplet-init.sh` is the first-boot user-data script that set the droplet up:

1. Adds a 2 GB swap file, so the image can build in 2 GB of RAM.
2. Installs Docker.
3. Clones the repository to `/opt/nextdrop`.
4. Writes `.env` with `COMPOSE_PROFILES=public`, the hostname, generated secrets and `DEMO_MODE=true`. The hostname is `DOMAIN` if it is set, otherwise `<ip>.sslip.io`.
5. Runs `docker compose up -d --build`.

Redeploying is `git pull` and `docker compose up -d --build` in `/opt/nextdrop`. The seed is idempotent (ADR 0030), so a redeploy keeps the demo state.

Amended 2026-10-04 by [ADR 0054](0054-redeploy-resets-demo.md): the init script and redeploys run `docker/redeploy.sh`, which resets the demo to a preset after the stack starts.

## Alternatives considered

- **Free PaaS tiers** (Render, Koyeb, Hugging Face Spaces, Cloud Run): they sleep or scale to zero. That drops the in-process SSE hub and pauses the pg-boss tick.
- **Free managed PostgreSQL** (Neon, Supabase): the per-minute tick keeps a scale-to-zero database running all month, so it uses up the free compute. Supabase also pauses idle projects. Either way it is one more provider to keep alive.
- **Always-free VMs** (Oracle Cloud, GCP e2-micro): signup and capacity are uncertain on submission day, and the providers can reclaim idle VMs. e2-micro has 1 GB of RAM.
- **1 GB droplet ($6):** too small to build the image on the droplet. The image would have to be built in CI and pulled from a registry, which is extra setup for $6 a month.
- **sslip.io name on the droplet's own IP** (`<ip>.sslip.io`): the first deployment used it. The URL would change if the droplet were ever recreated, and it looks less clear to judges.
- **A bought domain, or a free one from the GitHub Student Pack:** DNS might not update in time before the 4 Oct deadline, and a one-year domain needs renewing. DuckDNS is free, has no renewal and took minutes to set up. A domain can replace it later: change `CADDY_DOMAIN` and `PUBLIC_ORIGIN`, then run `docker compose up -d`.
- **No-IP free tier:** the hostname expires unless it is confirmed every 30 days, which could fall during judging.

## Consequences

- One machine runs the database, the app and the TLS proxy. There is no failover. A droplet backup or a `pg_dump` is the recovery path.
- The URL depends on DuckDNS answering DNS queries, and on the A record pointing at the Reserved IP. A rebuilt droplet only needs the Reserved IP reassigned to it. If DuckDNS fails, `137.184.250.211.sslip.io` is a fallback: set it as `CADDY_DOMAIN`.
- Only Dinura can redeploy: the droplet accepts only Dinura's SSH key.
- Caddy needs no Caddyfile:
  - `reverse_proxy` flushes `text/event-stream` responses at once, so SSE is not buffered.
  - The app sets the cache headers itself.
  - `sw.js` is served from the root, so its default scope is `/` and it needs no `Service-Worker-Allowed` header.
- Spec edits in this PR:
  - `spec/platform/deployment.md` names the host and gives the runbook.
  - C3 is removed from `spec/open-questions.md`.
  - The open item is removed from `spec/assumptions.md`.
