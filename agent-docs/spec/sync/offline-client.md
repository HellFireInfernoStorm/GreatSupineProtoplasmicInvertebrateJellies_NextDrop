---
status: draft
owner: Dinura
sources: guide §10
---

# Offline client architecture

- **Local-first reads**: Loader and Driver screens read from Dexie (`runs`, `trips`, `stops`, `orders`, `outlets`, `contacts`, `meta`), never directly from the network. Writes go to `outbox`. A repository layer hides the network.
- **Projected state** = server snapshot + pending outbox events folded through `rules.applyEvent`, so "saved on this phone" states render instantly and correctly.
- **Dexie stores**: `outbox` (clientEventId, deviceSeq, type, schemaVersion, capturedAt, clockOffsetMs, basedOnPlanVersion, subject, payload, state `pending|sending|acked|held|rejected|failed`, attempts, lastError, blobRefs), `blobQueue`, `snapshot*` tables, `conflictsLocal`, `meta` (feedCursor, deviceId, deviceSeq counter, serverOffset, localSession, locale, `simulateOffline`).
- **Sync controller** triggers: app start, `online` event, `visibilitychange` to visible, post-write, timer with exponential backoff and jitter, manual "Sync now". iOS Safari has no Background Sync: foreground triggers are the contract. Call `navigator.storage.persist()` and encourage "Add to Home Screen".
- **Always-visible sync state**: pending count, last synced time, failed items; driver sync pill `Synced / Syncing / Offline`; amber (never red) for offline. Reconnect shows progress, then conflicts side by side, then "All synced".
- **Service worker** (Workbox): precache app shell, field-role bundles, fonts, locale files, icons; runtime cache for static assets; navigation fallback to the shell so any field route loads offline. Update mode: prompt, applied at safe moments.
- **Local session**: the app stays usable offline while a local session exists ("works offline after first sign-in on this device"). The server session cookie is re-established on the next sync. If sync gets a 401, pause, ask for the PIN (`/auth/reauth`), keep the outbox intact, resume.
- **Store and Dispatcher** are online apps: TanStack Query cache, offline banner, read-only degradation of the last-seen view; no outbox.
- **Force-offline switch** (demo aid, per device): sets `meta.simulateOffline`, making the sync layer behave as if the network were down, so the dead zone -> reconnect -> clash sequence is repeatable on camera (browser DevTools offline also works).
- **Held facts** (ADR 0043): each pull asks `POST /sync/conflicts` about every fact still held, independent of the feed cursor and of `conflict_resolved` hints.
  - **Accepted:** becomes `acked` with the response's `feedHead` as its confirmation boundary and stays projected until a covering snapshot.
  - **Rejected:** becomes `rejected`, showing the dispatcher's note.
  - **Open or unknown:** stays held.
- **Reset epoch** (ADR 0007): the snapshot and every `/changes` response carry `resetEpoch`. If it differs from `meta.resetEpoch`, the client discards the outbox and local order data, stores the new epoch and shows 'Demo data was reset by <role> at <time>' before refetching the snapshot.
