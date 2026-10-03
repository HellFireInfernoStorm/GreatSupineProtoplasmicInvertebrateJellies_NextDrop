# ADR 0035: Blob reads, linking and upload idempotency

- Status: proposed
- Date: 2026-10-04
- Issue / PR: #50
- Designathon departure: no

## Context

[Blobs](../spec/sync/blobs.md) says uploads are idempotent and "blobs are served only to authorized roles". Issue #50 names the readers: the depot's dispatcher, the outlet's store manager and the uploading device's user. The contracts route table had an upload route but no read route, and `Blob` has no uploader column, only `ownerEventId`.

## Decision

1. **Read route.** A new contract route `GET /api/blobs/:id` (action `blob`, all roles as the ceiling, binary 200, 404). The path id is the `clientBlobId` that events reference.
2. **Who may read.** A blob is authorised through the event that owns it. The depot is the event's order outlet depot, else its trip's depot, else its vehicle's depot. Readers are:
   - the dispatchers of that depot
   - the store of the event's order outlet
   - the user who recorded the event

   A loader or driver who shares the depot but did not upload cannot read it. A blob with no owning event (uploaded before its event, never referenced) is readable by nobody. The policy layer models this as a `blob` resource.
3. **Linking.** An event whose payload references a blob is accepted whether or not the blob has arrived; the reference fields are `signatureBlobRef`, `photoBlobRefs`, `photoRef` and the store issue `photo`. Linking happens both ways:
   - When the event is stored, already-arrived blobs are linked to it.
   - When a blob arrives, it is linked to the earliest event from the uploading device and user that references it.

   The first link wins.
4. **Upload.** `PUT /sync/blobs/:id` (loader, driver) is idempotent on `clientBlobId`, and the first upload wins: a repeat returns the stored metadata, even with different bytes. The declared type must match the content's magic bytes (JPEG, PNG, WebP), otherwise 400 `SCHEMA_INVALID`. Other declared types are refused (415, or 400 for `text/plain`). Over `MAX_BLOB_BYTES` returns 413. Bytes sit behind a `BlobStore` interface with a Postgres `bytea` implementation.
5. **Responses.** Reads send the stored MIME type, `content-length` and `cache-control: private, max-age=86400`.

## Alternatives considered

- **An uploader column on `Blob`**: lets an uploader read an unlinked blob, but needs a schema change for a case the client never needs (it holds its own copy until the upload succeeds).
- **Last upload wins**: a retried upload with re-encoded bytes would silently replace proof of delivery.

## Consequences

- Store issue photos use the same store, but stores have no upload route yet (`PUT /sync/blobs` is field-only). A store upload route is a follow-up contract change.
- Spec edits in this PR: `sync/blobs.md` and `platform/api.md`.
