# ADR 0023: API wire contracts and client sync envelopes

- Status: proposed
- Date: 2026-10-03
- Issue / PR: #29
- Designathon departure: no

## Context

[API surface](../spec/platform/api.md) lists endpoints without complete wire shapes. Shared DTOs must unblock web mocks and API work. The stored event envelope requires server-assigned fields that a field client cannot know before sync. The [rules surface](../spec/rules-core/api-surface.md) and existing ops producers already define shapes that consumers must preserve.

## Decision proposed for Dinura's review

Use area-based Zod DTOs, one exported schema registry and a typed route table whose request parts and response statuses reference registry keys. Export populated fixtures checked against all DTO and route keys. Ownership remains enforced by the API policy layer. Preserve existing rules validation/config types and stored event payloads.

Supply the missing wire conventions in [API wire DTOs](../spec/platform/api-dtos.md): UUID primary IDs with separate display IDs, structured resource projections, explicit nullable absent assignment/draft/version values, optimistic draft revisions, status-specific error responses, role-discriminated auth/snapshots, CSRF/idempotency headers and string feed cursors. Add API error codes to the existing central vocabulary. For field pushes, derive client envelopes from existing payloads and omit server-assigned id, receivedAt and disposition; require field idempotency metadata. Stored envelopes and schemaVersion remain unchanged.

Model binary uploads and SSE hints explicitly. Propose an image upload cap of 512 KiB (524288 bytes) with JPEG/PNG/WebP MIME, leaving margin above the approximately 200 KB client compression target. One MAX_BLOB_BYTES constant supplies body, response-size and route limits; size-limited routes declare 413 PAYLOAD_TOO_LARGE. The API checks bytes, MIME and batch transport limits. Demo access metadata identifies dispatcher sessions or a script key, with demo mode required.

After PR #77 review, use a batch-aware parseClientEvent helper on server ingress and correlate REJECTED results by required original batch index, permitting a null clientEventId only when the input ID is invalid. Reauth uses explicit expired-session access: a retained cookie session may be expired but must not be revoked, with device/role/PIN/CSRF verification and rate limiting; normal mutations still require a live session. Fleet read projections permit absent history as null rather than requiring event reasons. Cursor-based history returns nextCursor. Request wrappers are strict and omit server-owned sourceEventId without changing event payloads.

These are proposed contract decisions, not owner-approved policy. Dinura must review the new wire conventions, credential/session-renewal boundary, error/status extensions, snapshot projection/config, and upload MIME/limit before merge. No code here grants authorization or enforces business constraints.

## Alternatives considered

- Keep arbitrary records for unspecified fields: would allow silent stripping and leave web consumers without useful mocks or inferred types.
- Make clients send the stored envelope: would require invented server metadata and confuse the trust boundary.
- Generate OpenAPI first: adds tooling and another source while Zod is already the repository's shared contract language.

## Consequences

Web and API can build against one typed inventory with realistic examples. Client and stored envelopes have a deliberate boundary without changing event payload versions. Completing previously unspecified shapes introduces owner-review work; the ADR remains proposed until accepted. A future DTO change must keep schemas, mocks and docs aligned.

## Open items

[Issue #78](https://github.com/HellFireInfernoStorm/GreatSupineProtoplasmicInvertebrateJellies_NextDrop/issues/78) tracks the existing missing SHORT_RESOLVED and LOAD_REVERSAL_REQUESTED route contracts. Existing implementation tasks #51 and #60 cover the workflows. Owner route decisions are required before adding endpoints; this PR does not invent them or claim that the current inventory completes those workflows.

Spec files edited in this change: `platform/api.md`, new `platform/api-dtos.md`, `platform/README.md`, `sync/push-protocol.md`, and `sync/blobs.md`.
