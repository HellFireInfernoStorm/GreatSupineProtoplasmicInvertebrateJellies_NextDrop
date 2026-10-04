import type { Prisma, PrismaClient } from "../../generated/prisma/client";

export type BlobMime = "image/jpeg" | "image/png" | "image/webp";

export interface StoredBlob {
  clientBlobId: string;
  mime: BlobMime;
  size: number;
}

/** Photos and signatures (spec/sync/blobs.md). Postgres `bytea` by default; another store can replace it. */
export interface BlobStore {
  /** Idempotent on `clientBlobId`: the first upload wins and a repeat returns it unchanged. */
  put(blob: { clientBlobId: string; mime: BlobMime; bytes: Uint8Array }): Promise<StoredBlob & { created: boolean }>;
  get(clientBlobId: string): Promise<(StoredBlob & { bytes: Uint8Array }) | null>;
}

export function createPostgresBlobStore(prisma: PrismaClient): BlobStore {
  return {
    async put({ clientBlobId, mime, bytes }) {
      const { count } = await prisma.blob.createMany({
        data: [{ clientBlobId, mime, size: bytes.byteLength, bytes: Buffer.from(bytes) }],
        skipDuplicates: true,
      });
      const row = await prisma.blob.findUniqueOrThrow({
        where: { clientBlobId },
        select: { clientBlobId: true, mime: true, size: true },
      });
      return { clientBlobId: row.clientBlobId, mime: row.mime as BlobMime, size: row.size, created: count === 1 };
    },
    async get(clientBlobId) {
      const row = await prisma.blob.findUnique({ where: { clientBlobId } });
      return row ? { clientBlobId, mime: row.mime as BlobMime, size: row.size, bytes: row.bytes } : null;
    },
  };
}

/** The content really is the declared image type (magic bytes), not just the header. */
export function matchesMime(bytes: Uint8Array, mime: BlobMime): boolean {
  const at = (offset: number, ...values: number[]) => values.every((v, i) => bytes[offset + i] === v);
  switch (mime) {
    case "image/jpeg":
      return at(0, 0xff, 0xd8, 0xff);
    case "image/png":
      return at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/webp":
      // "RIFF" <size> "WEBP"
      return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Blob references in an event payload (POD signature and photos, short/damage/problem photo, store issue photo). */
export function blobRefs(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) return [];
  const p = payload as Record<string, unknown>;
  const refs = [p.signatureBlobRef, p.photoRef, p.photo, ...(Array.isArray(p.photoBlobRefs) ? p.photoBlobRefs : [])];
  return [...new Set(refs.filter((r): r is string => typeof r === "string" && UUID.test(r)))];
}

/** Link blobs that already arrived to the event that references them; later arrivals link on upload. */
export async function linkArrivedBlobs(tx: Prisma.TransactionClient, eventId: string, payload: unknown): Promise<void> {
  const refs = blobRefs(payload);
  if (refs.length === 0) return;
  await tx.blob.updateMany({
    where: { clientBlobId: { in: refs }, ownerEventId: null },
    data: { ownerEventId: eventId },
  });
}
