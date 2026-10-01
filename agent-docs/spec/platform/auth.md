---
status: draft
owner: Dinura
sources: guide §13
---

# Authentication and authorization

- **Login shapes** (match the design): Store manager = outlet ID or email + password. Dispatcher = work email + password + depot selector. Loader = `LDR###` + PIN. Driver = `DRV###` + PIN. Secrets hashed with argon2; login rate-limited with lockout backoff.
- **Sessions**: server-side `Session` rows, httpOnly SameSite=Lax cookie, sliding expiry (web roles ~12 h; field roles ~14 days). Mutations require a custom header (CSRF defence). Field roles can re-authenticate with their PIN via `/auth/reauth` without losing the outbox.
- **Seeded accounts**: exactly one account per role for judges (section 15.3), plus a few extras (second store, Kandy loader/driver) for demo scenarios.
- **Authorization**: one central policy layer, deny by default. Every route declares `{ action, resourceResolver }` and calls `can(actor, action, resource)`. Scopes: store -> own outlet's orders; dispatcher -> their depot(s); loader -> their depot; driver -> their vehicle's trips. A `scoped(actor)` helper builds Prisma `where` clauses so list queries cannot leak across scopes. Change-feed and blob reads are audience-filtered.
- **Why it matters**: the SPA ships all role code, so the API is the only security boundary. A generated role x endpoint x ownership test matrix MUST pass in CI.
- **Hardening**: helmet/CSP, upload mime+size validation, parameterized queries only, no secrets in the client bundle.
