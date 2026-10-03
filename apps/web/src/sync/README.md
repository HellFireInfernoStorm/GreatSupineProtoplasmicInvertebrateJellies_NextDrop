# Field offline core (#40)

Loader and Driver screens import from `src/sync/index.ts`:

- `useFieldSnapshot()` reads the signed-in user's saved snapshot; no screen fetches field data directly.
- `useProjectedOrder(orderId)` folds pending/sending facts over the snapshot through `rules.applyEvent`. The returned reducer state is advisory; server confirmation remains authoritative.
- `fieldRepository.enqueue({ type, payload, subject, actor, blobRefs? })` records a durable intent. UUID v7, device sequence, capture time, clock offset and current plan version are allocated inside the IndexedDB transaction. Render a saved confirmation only after this promise resolves.
- `queuePhoto(blob, userId)` compresses evidence before storage and returns the client blob ID for the event payload. Text and binary queues retry independently; text is sent first.
- `useSyncDiagnostics()` exposes pending work, rejected records/reasons, held facts and last server-aware sync time. `syncController.syncNow()` is the manual trigger. `setForceOffline()` persists the per-device demo switch.

`FieldSync` owns foreground listeners in the field shell, the PIN prompt and diagnostics. It uses the existing session and CSRF APIs. Reloads restore only validated Loader/Driver sessions; an offline load or `/auth/me` 401 keeps the shell and asks for PIN. Wrong PIN/lockout leaves the session/work intact. Nonrenewable authentication or logout removes authentication; queued work remains bound to its original user and is not replayed by another account.

The controller owns one flight per tab and one cross-tab owner per database (Web Locks, with a renewable IndexedDB lease fallback). Interrupted sending rows retry with their original IDs. A correlated ACCEPTED/DUPLICATE/HELD_CONFLICT/REJECTED result is required before an event stops counting as pending. Held and failed records stay visible. Push feedHead is never a pull cursor. Empty audience-filtered pages advance to head; full pages use the last item's string sequence. Changed pages trigger one atomic snapshot replacement, keeping the outbox. Epoch changes are checked before replay, and explicitly discard pre-reset data under ADR 0007.

The Vite Workbox build precaches the shell, role chunks, local fonts, locales and icons; `/api` never falls through to the cached shell. The update prompt requires explicit confirmation of an idle/between-stops moment and disables activation during sync. Tests use fake-indexeddb; production-browser verification must use `pnpm build` and `pnpm preview`, because the worker is intentionally disabled in development.

Server endpoints and field screens remain separate issues. `VITE_API_MOCK=true` uses the contract fixtures, with correlated acknowledgements for the submitted event IDs. Mock snapshots are static examples and do not simulate a complete evolving backend.
