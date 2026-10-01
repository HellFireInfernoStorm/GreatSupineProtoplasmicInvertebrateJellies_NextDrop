---
status: draft
owner: Dinura
sources: guide §9.3
---

# Blobs

## 9.3 Blobs (photos, signatures)

Separate retry queue. Text events sync first; blobs after. The client compresses photos before queuing (target <= ~200 KB, max dimension ~1280). Events reference blobs by `clientBlobId`; the event is accepted with the blob `pending`. `PUT` is idempotent on `clientBlobId`; the server validates mime and size and stores bytes via the `BlobStore` interface (Postgres `bytea` by default). Blobs are served only to authorized roles.
