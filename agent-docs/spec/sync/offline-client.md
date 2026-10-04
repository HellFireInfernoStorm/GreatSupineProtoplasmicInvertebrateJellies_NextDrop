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

## Driver recovery gates (ADR 0050)

“All synced” describes server receipt of text and proof, not dispatcher acceptance. Held facts keep Needs dispatch, their historical context and proof, and remain inert. Changed-plan review waits for queued work, covering snapshots for accepted events and context for held facts to reconcile; it may then show while received clashes await dispatch. Store PLAN_ACKNOWLEDGED receipts per user/run/epoch/version across pruning. Only an accepted acknowledgement with a covering snapshot permanently dismisses that version's review. Held/rejected acknowledgements remain visible.

## Loader recording and Undo (ADR 0051)

Loader actions first persist as scoped Dexie metadata drafts for a five-second Undo window. Drafts include the original capture time/offset, event intents, optional compressed evidence, and a durable receipt identity. They project locally but are not sent. Undo cancels only an unexpired draft. After expiry, events, evidence and receipt enter the existing queues atomically; a cold start resumes promotion for the same user. A changed-plan draft remains saved for explicit discard/review rather than taking the new version. Account switching leaves other users' drafts inert; demo reset clears all drafts and plan baselines.

Snapshot order projections seed loaded quantities as well as short/damaged flags before folding pending, sending and accepted-until-covered events through the shared reducer. Loader receipts survive covering-snapshot pruning. Text server receipt does not imply proof upload or dispatcher approval. Plan acknowledgements dismiss the version's review only after acceptance and a covering snapshot.
