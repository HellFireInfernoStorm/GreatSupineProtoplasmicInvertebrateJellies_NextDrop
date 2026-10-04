// Photos and signatures (spec/sync/blobs.md): idempotent upload, linking to events, authorised reads.
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client";
import { blobRoutes } from "./routes";
import { createPostgresBlobStore, type BlobStore } from "./store";

export { blobRefs, createPostgresBlobStore, linkArrivedBlobs, matchesMime, type BlobStore } from "./store";

export async function registerBlobs(app: FastifyInstance, deps: { prisma: PrismaClient | null; store?: BlobStore }) {
  if (!deps.prisma) return;
  await app.register(blobRoutes, { prisma: deps.prisma, store: deps.store ?? createPostgresBlobStore(deps.prisma) });
}
