import {
  blobBodySchema,
  blobHeadersSchema,
  blobResponseSchema,
  idParamsSchema,
  MAX_BLOB_BYTES,
} from "@nextdrop/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { ApiHttpError, forbidden, notFound } from "../../lib/errors";
import { collectionResource, type ResourceResolver } from "../policy";
import { matchesMime, type BlobMime, type BlobStore } from "./store";

export interface BlobRouteDependencies {
  prisma: PrismaClient;
  store: BlobStore;
}

const IMAGE_TYPES: BlobMime[] = ["image/jpeg", "image/png", "image/webp"];

/** Who may read a blob, through the event that references it (ADR 0035). */
function blobResource(prisma: PrismaClient): ResourceResolver {
  return async (request) => {
    const { id } = request.params as { id: string };
    const blob = await prisma.blob.findUnique({
      where: { clientBlobId: id },
      select: {
        ownerEvent: {
          select: {
            actorUserId: true,
            order: { select: { outletId: true, outlet: { select: { depot: true } } } },
            trip: { select: { planningDay: { select: { depot: true } } } },
            vehicle: { select: { depot: true } },
          },
        },
      },
    });
    if (!blob) throw notFound();
    const owner = blob.ownerEvent;
    return {
      kind: "blob",
      depot: owner?.order?.outlet.depot ?? owner?.trip?.planningDay.depot ?? owner?.vehicle?.depot ?? null,
      outletId: owner?.order?.outletId ?? null,
      uploaderUserId: owner?.actorUserId ?? null,
    };
  };
}

/** `PUT /sync/blobs/:id` (idempotent upload) and `GET /blobs/:id` (authorised read). spec/sync/blobs.md. */
export const blobRoutes: FastifyPluginAsyncZod<BlobRouteDependencies> = async (app, deps) => {
  const { prisma, store } = deps;
  // Raw image bytes, scoped to this plugin. Any other content type is 415 before the handler runs.
  app.addContentTypeParser(IMAGE_TYPES, { parseAs: "buffer", bodyLimit: MAX_BLOB_BYTES }, (_request, body, done) =>
    done(null, body),
  );

  app.put(
    "/api/sync/blobs/:id",
    {
      bodyLimit: MAX_BLOB_BYTES,
      schema: {
        params: idParamsSchema,
        headers: blobHeadersSchema,
        body: blobBodySchema,
        response: { 200: blobResponseSchema },
      },
      config: { policy: { action: "uploadBlob", resourceResolver: collectionResource } },
    },
    async (request) => {
      const actor = request.actor;
      if (actor?.role !== "LOADER" && actor?.role !== "DRIVER") throw forbidden();
      const mime = request.headers["content-type"];
      const bytes = request.body;
      if (!matchesMime(bytes, mime)) {
        throw new ApiHttpError(400, "SCHEMA_INVALID", "blobs.contentMismatch", { mime });
      }
      const stored = await store.put({ clientBlobId: request.params.id, mime, bytes });
      // An event from this device may already reference the blob: link it now (first link wins).
      const owner = await prisma.orderEvent.findFirst({
        where: {
          deviceId: actor.deviceId ?? undefined,
          actorUserId: actor.userId,
          OR: [
            { payload: { path: ["photoRef"], equals: stored.clientBlobId } },
            { payload: { path: ["signatureBlobRef"], equals: stored.clientBlobId } },
            { payload: { path: ["photoBlobRefs"], array_contains: [stored.clientBlobId] } },
          ],
        },
        orderBy: { id: "asc" },
        select: { id: true },
      });
      if (owner) {
        await prisma.blob.updateMany({
          where: { clientBlobId: stored.clientBlobId, ownerEventId: null },
          data: { ownerEventId: owner.id },
        });
      }
      return { clientBlobId: stored.clientBlobId, mime: stored.mime, size: stored.size };
    },
  );

  app.get(
    "/api/blobs/:id",
    {
      schema: { params: idParamsSchema },
      config: { policy: { action: "blob", resourceResolver: blobResource(prisma) } },
    },
    async (request, reply) => {
      const blob = await store.get(request.params.id);
      if (!blob) throw notFound();
      return reply
        .type(blob.mime)
        .header("cache-control", "private, max-age=86400")
        .header("content-length", String(blob.size))
        .send(Buffer.from(blob.bytes));
    },
  );
};
