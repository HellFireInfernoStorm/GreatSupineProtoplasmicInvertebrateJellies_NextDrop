# ADR 0028: Auth session, lockout and policy details

- Status: proposed
- Date: 2026-10-03
- Issue / PR: #35
- Designathon departure: no

## Context

[Auth](../spec/platform/auth.md), [API wire DTOs](../spec/platform/api-dtos.md) and ADR 0024 define the login shapes, server-side sessions, the CSRF header, field reauth and a deny-by-default policy layer. Issue #35 implements them. The current schema and spec leave five things open:

1. `User.depot` is a single nullable column, but the dispatcher session user carries `depots[]`, the login takes a depot selector, and the walkthrough has Nimal switch from Peliyagoda to Kandy ([seed and demo](../spec/data/seed-and-demo.md) §15.5).
2. Login and reauth need "lockout backoff", but there are no lockout columns and no thresholds.
3. Session responses return a `csrfToken`, but `Session` has no column for one.
4. ADR 0024 keeps expired FIELD rows for reauth, but a cookie that expires with the session would stop the client from presenting it.
5. "Every route declares `{ action, resourceResolver }`" does not say what an action is.

## Decision

1. **Dispatcher depots.** A dispatcher whose `User.depot` is set covers that depot only. A dispatcher whose `User.depot` is null covers every reference depot (the distinct `District.depot` values). The login `depot` must be in that set, otherwise the login fails with `INVALID_CREDENTIALS`. The selected depot is not stored on the session: day operations already take `depot` in the query, and the policy layer checks it against the dispatcher's set.
2. **Lockout.** Failures are counted in API process memory, per account for login (per typed login ID when no account matches) and per session for reauth. After 5 failures, each further failure locks the key for 30 s, doubling up to 15 min. While locked, login and reauth return 429 `RATE_LIMITED` with `retryAfterSeconds` and `Retry-After`. A success clears the counter. Separately, `@fastify/rate-limit` caps login and reauth at 30 requests per minute per IP.
3. **CSRF token.** `csrfToken` is HMAC-SHA256(`SESSION_SECRET`, session id). Every mutation on a session route must send it in `x-nextdrop-csrf`. Login has no session yet, so it needs only a nonempty header. The session cookie value is the session id signed with `SESSION_SECRET` (`@fastify/cookie`).
4. **Cookie lifetime.** The cookie is `nextdrop_session`: httpOnly, SameSite=Lax, path `/api`, and `Secure` in production or when `PUBLIC_ORIGIN` is https. Its Max-Age follows sliding expiry: the TTL for WEB sessions, and the TTL plus `FIELD_REAUTH_GRACE_DAYS` for FIELD sessions, so a field device can still present an expired session to `/auth/reauth`. Expired WEB rows, and FIELD rows past the grace window, are deleted when presented.
5. **Actions.** A policy action is the operation name in the contracts route table (`apiRoutes`), for example `storeOrder`. `can()` uses that route's `roles` as the role ceiling and its `access` as the access mode, then checks resource ownership. When a route is registered, the server checks that it declares a policy and that the action's contract method and path match the route. A route without a policy cannot be registered.

## Alternatives considered

- **A `depots String[]` column on User**: explicit, but it is a schema change and owner review for one seeded dispatcher. A null-means-all rule covers the walkthrough and can move to a column later without changing the session DTO.
- **Lockout columns on User and Session**: survives restarts and multiple instances, but needs a migration. The API runs as one container (deployment.md), and losing counters on restart only shortens a lock.
- **A random CSRF token stored per session**: needs a column. The HMAC gives the same per-session secrecy without one.
- **A separate action vocabulary (`order.read`, ...)**: a second list to keep in step with the route table, and the generated authorization matrix (#58) would have to map between them.

## Consequences

- The policy layer and the generated matrix (#58) both read the route table. Adding a route means declaring its contract operation as the action.
- Lockout state resets when the API restarts. If the API ever runs as more than one instance, lockout needs shared storage (a table or the database).
- Rotating `SESSION_SECRET` signs everyone out and invalidates every CSRF token.
- A dispatcher limited to one depot needs `User.depot` set by the seed (#30).
- Spec edits in this PR: `spec/platform/auth.md`.
