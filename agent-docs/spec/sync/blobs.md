---
status: draft
owner: Dinura
sources: guide §9.3
---

# Blobs

## 9.3 Blobs (photos, signatures)

Separate retry queue. Text events sync first; blobs after. The client compresses photos before queuing (target <= ~200 KB, max dimension ~1280). Events reference blobs by `clientBlobId`; the event is accepted with the blob `pending`. `PUT` is idempotent on `clientBlobId`; the server validates mime and size and stores bytes via the `BlobStore` interface (Postgres `bytea` by default). Blobs are served only to authorized roles.

The hard upload cap is 512 KiB (524288 bytes), allowing margin above the compression target. `MAX_BLOB_BYTES` in contracts supplies the same limit for body validation, response metadata and route transport configuration. Larger uploads return 413 PAYLOAD_TOO_LARGE. MIME is JPEG, PNG or WebP. These wire details are accepted in [ADR 0024](../../adr/0024-api-wire-contracts.md).

Reads and linking (ADR 0035):
- **Read route.** `GET /api/blobs/:id` serves a blob by `clientBlobId`, authorised through the event that references it: the depot's dispatchers, the order outlet's store, and the user who recorded the event. A blob no event references yet is readable by nobody.
- **Linking.** An event is linked to blobs that already arrived when it is stored, and a later upload links to the earliest referencing event from the same device and user.
- **Upload.** The first upload of a `clientBlobId` wins. The declared type must match the content's magic bytes.
