import { changesQuerySchema, changesResponseSchema, streamQuerySchema, type FeedKind } from "@nextdrop/contracts";
import type { ServerResponse } from "node:http";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { isSessionActive } from "../auth";
import { collectionResource, scoped } from "../policy";
import { createFeedHub, type FeedHint } from "./hub";

export interface FeedRouteDependencies {
  prisma: PrismaClient | null;
  now: () => Date;
  /** SSE comment heartbeat (spec: 25 s). */
  heartbeatMs: number;
  /** Shared head poll while streams are open. */
  pollMs: number;
}

const DEFAULT_LIMIT = 500;

/** `GET /changes` (cursor pull) and `GET /stream` (SSE head hints). spec/sync/change-feed.md, ADR 0027. */
export const feedRoutes: FastifyPluginAsyncZod<FeedRouteDependencies> = async (app, deps) => {
  const database = () => {
    if (!deps.prisma) throw new Error("The change feed needs a database");
    return deps.prisma;
  };

  async function readHint(): Promise<FeedHint> {
    const prisma = database();
    const [counter, demo] = await Promise.all([
      prisma.feedCounter.findUniqueOrThrow({ where: { singleton: true }, select: { head: true } }),
      prisma.demoState.findUnique({ where: { singleton: true }, select: { resetEpoch: true } }),
    ]);
    return { head: counter.head.toString(), resetEpoch: demo?.resetEpoch ?? 0 };
  }

  const hub = createFeedHub(readHint, deps.pollMs, (error) => app.log.error({ err: error }, "feed head poll failed"));
  const streams = new Set<ServerResponse>();
  app.addHook("preClose", async () => {
    hub.close();
    for (const stream of streams) stream.end();
  });

  app.get(
    "/api/changes",
    {
      schema: { querystring: changesQuerySchema, response: { 200: changesResponseSchema } },
      config: { policy: { action: "changes", resourceResolver: collectionResource } },
    },
    async (request) => {
      // Read head first and bound the items by it: every row at or below a committed head is committed, so a
      // client that receives fewer than `limit` items may move its cursor to `head` without missing a row.
      const hint = await readHint();
      const head = BigInt(hint.head);
      const after = BigInt(request.query.after);
      const rows =
        after >= head
          ? []
          : await database().changeFeed.findMany({
              where: { AND: [scoped(request.actor!).changeFeed, { seq: { gt: after, lte: head } }] },
              orderBy: { seq: "asc" },
              take: request.query.limit ?? DEFAULT_LIMIT,
            });
      return {
        items: rows.map((row) => ({
          seq: row.seq.toString(),
          kind: row.kind as FeedKind,
          entity: { type: row.entityType, id: row.entityId },
          ...(row.version === null ? {} : { version: row.version }),
          at: row.createdAt.toISOString(),
        })),
        head: hint.head,
        resetEpoch: hint.resetEpoch,
      };
    },
  );

  app.get(
    "/api/stream",
    {
      schema: { querystring: streamQuerySchema },
      config: { policy: { action: "stream", resourceResolver: collectionResource } },
    },
    async (request, reply) => {
      const sessionId = request.authSession!.id;
      const first = await readHint();
      reply.hijack();
      const res = reply.raw;
      streams.add(res);
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        // Disable proxy buffering (Caddy/nginx) so hints arrive immediately.
        "x-accel-buffering": "no",
      });
      res.flushHeaders();

      let lastSent = "";
      const send = (hint: FeedHint) => {
        const data = JSON.stringify(hint);
        if (data === lastSent || res.writableEnded) return;
        lastSent = data;
        res.write(`data: ${data}\n\n`);
      };
      res.write("retry: 5000\n\n");
      send(first);
      const unsubscribe = hub.subscribe(send);
      const heartbeat = setInterval(() => {
        void isSessionActive(database(), sessionId, deps.now())
          .then((active) => {
            if (!active) res.end();
            else if (!res.writableEnded) res.write(": heartbeat\n\n");
          })
          .catch((error: unknown) => request.log.error({ err: error }, "stream session check failed"));
      }, deps.heartbeatMs);
      res.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
        streams.delete(res);
      });
    },
  );
};
