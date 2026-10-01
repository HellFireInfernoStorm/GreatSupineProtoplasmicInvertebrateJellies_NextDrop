---
status: draft
owner: Dinura
sources: guide §9, §9.1-9.2
---

# Sync shape and push protocol

## 9.1 Shape

Push: `POST /sync/events` (batched, idempotent). Blobs: `PUT /sync/blobs/:clientBlobId`. Pull: `GET /changes?after=<cursor>` plus `GET /field/snapshot`. Hint: `GET /stream` (SSE).

## 9.2 Push protocol

Request: `{ deviceId, events: [EventEnvelope-from-client...] }` (max 100 events / 1 MB). Events are processed **in `deviceSeq` order**, each in its own short transaction (section 6.3):

1. Validate with zod (`SCHEMA_INVALID` on failure) and upcast old `schemaVersion`s.
2. Authorize: actor, role, and subject must be in the actor's scope (`FORBIDDEN`, `NOT_ASSIGNED`).
3. Idempotency: known `clientEventId` -> `DUPLICATE`.
4. Lock the order row; classify (9.5); reduce; update projection; derive consequences; append feed rows.

Response: `{ results: [{ clientEventId, status, code?, conflictId?, serverEventId?, receivedAt }], serverTime, feedHead }` where `status` is:

| Status | Client action |
| --- | --- |
| `ACCEPTED` | mark acked |
| `DUPLICATE` | mark acked |
| `HELD_CONFLICT` | mark acked; show local conflict card; fact is preserved server-side |
| `REJECTED` (+ code) | move to visible **failed** state with reason; never silently dropped |
| network/5xx (no result) | keep pending; retry with backoff |

One bad event never fails the batch. Later events that depend on a rejected one are rejected with `ILLEGAL_TRANSITION` and shown grouped with it.
