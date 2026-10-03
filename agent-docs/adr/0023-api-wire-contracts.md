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

Model binary uploads and SSE hints explicitly. Propose an image upload cap of 204800 bytes with JPEG/PNG/WebP MIME; compression remains a client concern. The API checks bytes, MIME and batch transport limits. Demo access metadata identifies dispatcher sessions or a script key, with demo mode required.

These are proposed contract decisions, not owner-approved policy. Dinura must review the new wire conventions, credential/session-renewal boundary, error/status extensions, snapshot projection/config, and upload MIME/limit before merge. No code here grants authorization or enforces business constraints.

## Alternatives considered

- Keep arbitrary records for unspecified fields: would allow silent stripping and leave web consumers without useful mocks or inferred types.
- Make clients send the stored envelope: would require invented server metadata and confuse the trust boundary.
- Generate OpenAPI first: adds tooling and another source while Zod is already the repository's shared contract language.

## Consequences

Web and API can build against one typed inventory with realistic examples. Client and stored envelopes have a deliberate boundary without changing event payload versions. Completing previously unspecified shapes introduces owner-review work; the ADR remains proposed until accepted. A future DTO change must keep schemas, mocks and docs aligned.

Spec files edited in this change: `platform/api.md`, new `platform/api-dtos.md`, `platform/README.md`, and `sync/push-protocol.md`.
