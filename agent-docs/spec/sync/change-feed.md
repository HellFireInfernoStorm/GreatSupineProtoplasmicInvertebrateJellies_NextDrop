---
status: draft
owner: Dinura
sources: guide §9.4
---

# Change feed and snapshot

## 9.4 Pull: change feed and snapshot

- `ChangeFeed.seq` is assigned from `FeedCounter` with `UPDATE ... SET head = head + n RETURNING head` as the **last statements of every writing transaction**. The row lock held until commit makes sequences gap-free and commit-ordered, so a reader never misses a lower sequence that commits later.
- `GET /changes?after=<seq>&limit=` returns rows visible to the caller (audience columns checked server-side): `{ items: [{ seq, kind, entity: {type, id}, version?, at }], head }`. Kinds include `plan_published`, `order_changed`, `conflict_opened`, `conflict_resolved`, `notification_created`, `run_updated`, `availability_changed`.
- SSE (`/stream`) only sends `head` hints. Clients compare to their cursor and call `/changes`. Reconnect uses the cursor; nothing depends on SSE delivery. Polling (15-30 s) is the fallback.
- **Online roles** (store, dispatcher) invalidate TanStack Query caches by `entity.type`.
- **Field roles** refetch `GET /field/snapshot` when a relevant feed row arrives. Snapshot = `{ planVersion, serverTime, feedCursor, resetEpoch, scope data, config }`: for a driver, the vehicle's run (trips, stops, order lines, outlet details, contacts, dock types, ETAs, windows, reason-code lists); for a loader, the depot's trips for the date with orders, lines and stop sequences. It replaces the server-derived Dexie tables in one transaction and never touches the outbox.
- `GET /changes` and the SSE hint also carry `resetEpoch` (ADR 0007).
- The single `FeedCounter` row serialises all writing transactions. This is accepted at this scale (four roles, one depot-sized load) and the LISTEN/NOTIFY path in the deployment note is the way out.
