import {
  mutationHeadersSchema,
  notificationsQuerySchema,
  notificationsResponseSchema,
  readNotificationsRequestSchema,
  readNotificationsResponseSchema,
  type ApiError,
} from "@nextdrop/contracts";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { ApiHttpError } from "../../lib/errors";
import { collectionResource, scoped, type Action } from "../policy";
import { groupOf } from "./notifier";

export interface NotificationRouteDependencies {
  prisma: PrismaClient | null;
  now: () => Date;
}

const DEFAULT_LIMIT = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type ListQuery = z.infer<typeof notificationsQuerySchema>;
type ReadBody = z.infer<typeof readNotificationsRequestSchema>;

/** `GET /notifications`, `POST /notifications/read`, and the store aliases in spec/platform/api.md. */
export const notificationRoutes: FastifyPluginAsyncZod<NotificationRouteDependencies> = async (app, deps) => {
  const database = () => {
    if (!deps.prisma) throw new Error("Notifications need a database");
    return deps.prisma;
  };

  async function list(request: FastifyRequest, query: ListQuery) {
    // Newest first by UUIDv7 id; `after` is the last id of the previous page.
    if (query.after !== undefined && !UUID.test(query.after)) {
      throw new ApiHttpError(400, "SCHEMA_INVALID", "errors.schemaInvalid", { field: "after" });
    }
    const prisma = database();
    const own = scoped(request.actor!).notifications;
    const filters: Prisma.NotificationWhereInput[] = [own];
    if (query.unreadOnly === "true") filters.push({ readAt: null });
    if (query.after) filters.push({ id: { lt: query.after } });
    const limit = query.limit ?? DEFAULT_LIMIT;
    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where: { AND: filters }, orderBy: { id: "desc" }, take: limit + 1 }),
      prisma.notification.count({ where: { AND: [own, { readAt: null }] } }),
    ]);
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        kind: row.kind,
        titleKey: row.titleKey,
        params: row.params as ApiError["params"],
        entityRef: row.entityRef as { type: string; id: string },
        createdAt: row.createdAt.toISOString(),
        readAt: row.readAt?.toISOString() ?? null,
        group: groupOf(row.kind),
      })),
      unreadCount,
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
    };
  }

  async function markRead(request: FastifyRequest, body: ReadBody) {
    const readAt = deps.now();
    const { count } = await database().notification.updateMany({
      where: {
        AND: [scoped(request.actor!).notifications, { readAt: null }, body.all ? {} : { id: { in: body.ids } }],
      },
      data: { readAt },
    });
    return { updatedCount: count, readAt: readAt.toISOString() };
  }

  const register = (listAction: Action, readAction: Action, base: string) => {
    app.get(
      base,
      {
        schema: { querystring: notificationsQuerySchema, response: { 200: notificationsResponseSchema } },
        config: { policy: { action: listAction, resourceResolver: collectionResource } },
      },
      async (request) => list(request, request.query),
    );
    app.post(
      `${base}/read`,
      {
        schema: {
          headers: mutationHeadersSchema,
          body: readNotificationsRequestSchema,
          response: { 200: readNotificationsResponseSchema },
        },
        config: { policy: { action: readAction, resourceResolver: collectionResource } },
      },
      async (request) => markRead(request, request.body),
    );
  };
  register("notifications", "notificationsRead", "/api/notifications");
  register("storeNotifications", "storeNotificationsRead", "/api/store/notifications");
};
