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

The client form reuses the catalogue payload schemas but omits server-assigned `id`, `receivedAt` and `disposition`. It requires `clientEventId`, `deviceId`, `deviceSeq`, `schemaVersion`, `subject`, `source: FIELD`, the loader/driver `actor`, and `capturedAt`; `clockOffsetMs` and `basedOnPlanVersion` remain optional. Only field-authored catalogue types are accepted. Each event's deviceId must match the batch deviceId. The API still verifies actor identity, allowed event author, subject ownership and monotonic processing; declared actor metadata does not authorize a client. The stored [event envelope](../events/envelope.md) is unchanged. These newly specified wire details are proposed in ADR 0023 for owner review.

The request schema enforces the 100-event cap; the API enforces the serialized 1 MB transport cap (413 PAYLOAD_TOO_LARGE). One malformed event must not reject valid neighbours: parse batch framing with `syncEventsIngressRequestSchema`, then call `parseClientEvent(raw, batchDeviceId, index, receivedAt, registry?)` for each raw event. Preserve the original zero-based input index before sorting valid events by deviceSeq. The complete batch schema describes valid requests for clients and mocks, not legacy payload ingress.

1. Validate loose type/version framing: only field types and integer versions 1..SCHEMA_VERSION. Upcast the unknown payload with `upcastPayload` and the shared registry (or an injected test registry), then validate the complete event against current schemas. Return correlated SCHEMA_INVALID on malformed framing, invalid upgraded data or a throwing upcaster. Normalize the accepted event's schemaVersion to SCHEMA_VERSION so persistence records the version of the upgraded payload, preserving capturedAt and leaving raw client input unchanged. Batch device mismatch on a valid event returns FORBIDDEN.
2. Authorize: actor, role, and subject must be in the actor's scope (`FORBIDDEN`, `NOT_ASSIGNED`).
3. Idempotency: known `clientEventId` -> `DUPLICATE`.
4. Lock the order row; classify (9.5); reduce; update projection; derive consequences; append feed rows.

Response: `{ results: [{ clientEventId, status, index?, code?, conflictId?, serverEventId?, receivedAt }], serverTime, feedHead }` where `status` is:

| Status | Client action |
| --- | --- |
| `ACCEPTED` | mark acked |
| `DUPLICATE` | mark acked |
| `HELD_CONFLICT` | mark acked; show local conflict card; fact is preserved server-side |
| `REJECTED` (+ code) | move to visible **failed** state with reason; never silently dropped |
| network/5xx (no result) | keep pending; retry with backoff |

One bad event never fails the batch. Later events that depend on a rejected one are rejected with `ILLEGAL_TRANSITION` and shown grouped with it.

The result DTO is discriminated by status: ACCEPTED carries its serverEventId, HELD_CONFLICT carries conflictId, and REJECTED requires code and the original zero-based batch index. Only REJECTED permits clientEventId null, when the input ID is missing or invalid; preserve a valid ID even when another field is invalid. The client uses index to correlate such rejections to the submitted batch instead of silently retrying them. Non-rejected results require a valid UUID. DUPLICATE can include the original serverEventId/code. Every result has receivedAt; feedHead is a decimal string, preserving feed sequence precision. String cursor and result-detail conventions are part of the proposed #29 wire contracts.
