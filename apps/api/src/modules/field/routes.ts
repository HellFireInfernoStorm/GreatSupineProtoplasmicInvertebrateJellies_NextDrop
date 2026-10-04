import {
  dateQuerySchema,
  fieldSnapshotSchema,
  heartbeatRequestSchema,
  heartbeatResponseSchema,
  mutationHeadersSchema,
  syncEventsIngressRequestSchema,
  syncEventsResponseSchema,
} from "@nextdrop/contracts";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { forbidden } from "../../lib/errors";
import { colomboLocal } from "@nextdrop/rules";
import { appendFeed, readFeedHint } from "../feed";
import { dateOnly, NO_SIGNAL_AFTER_MIN } from "../orders";
import { collectionResource, type Actor } from "../policy";
import type { Ingest } from "./ingest";
import { buildSnapshot } from "./snapshot";

export interface FieldRouteDependencies {
  prisma: PrismaClient;
  now: () => Date;
  ingest: Ingest;
}

/** Serialized-bytes cap on a push batch (push-protocol.md); exceeding it returns 413 PAYLOAD_TOO_LARGE. */
export const SYNC_BODY_LIMIT = 1_000_000;

function fieldActor(request: FastifyRequest): Extract<Actor, { role: "LOADER" | "DRIVER" }> {
  const actor = request.actor;
  if (actor?.role !== "LOADER" && actor?.role !== "DRIVER") throw forbidden();
  return actor;
}

/** The session's device must be the device that speaks: field sessions are bound to one deviceId (ADR 0024). */
function ownDevice(request: FastifyRequest, deviceId: string) {
  const actor = fieldActor(request);
  if (actor.deviceId !== deviceId) throw forbidden("errors.deviceMismatch");
  return actor;
}

/** `GET /field/snapshot`, `POST /sync/events` and `POST /sync/heartbeat`. Field roles mutate only through /sync/*. */
export const fieldRoutes: FastifyPluginAsyncZod<FieldRouteDependencies> = async (app, deps) => {
  const { prisma } = deps;

  app.get(
    "/api/field/snapshot",
    {
      schema: { querystring: dateQuerySchema, response: { 200: fieldSnapshotSchema } },
      config: { policy: { action: "snapshot", resourceResolver: collectionResource } },
    },
    async (request) => buildSnapshot(prisma, fieldActor(request), request.query.date, deps.now()),
  );

  app.post(
    "/api/sync/events",
    {
      bodyLimit: SYNC_BODY_LIMIT,
      schema: {
        headers: mutationHeadersSchema,
        body: syncEventsIngressRequestSchema,
        response: { 200: syncEventsResponseSchema },
      },
      config: { policy: { action: "syncEvents", resourceResolver: collectionResource } },
    },
    async (request) => deps.ingest.ingest(ownDevice(request, request.body.deviceId), request.body),
  );

  app.post(
    "/api/sync/heartbeat",
    {
      schema: {
        headers: mutationHeadersSchema,
        body: heartbeatRequestSchema,
        response: { 200: heartbeatResponseSchema },
      },
      config: { policy: { action: "heartbeat", resourceResolver: collectionResource } },
    },
    async (request) => {
      const body = request.body;
      const actor = ownDevice(request, body.deviceId);
      const now = deps.now();
      const lastSyncAt = body.lastSyncAt ? new Date(body.lastSyncAt) : null;
      await prisma.$transaction(async (tx) => {
        const before = await tx.device.findUnique({
          where: { id: body.deviceId },
          select: { lastSeenAt: true, pendingCount: true, lastSyncAt: true },
        });
        // lastHeardAt for D4 and the store's no-signal view comes from here and from accepted events.
        await tx.device.update({
          where: { id: body.deviceId },
          data: {
            lastSeenAt: now,
            appVersion: body.appVersion,
            pendingCount: body.pendingCount,
            lastSyncAt,
            lastKnownStop: body.lastKnownStop,
          },
        });
        // Hint the driver's runs only when the monitor would show something new: the run is heard again after a
        // silence, or the pending count or last sync moved (ADR 0041). A steady heartbeat writes no feed rows.
        if (actor.role !== "DRIVER" || !before) return;
        const changed =
          now.getTime() - before.lastSeenAt.getTime() > NO_SIGNAL_AFTER_MIN * 60_000 ||
          before.pendingCount !== body.pendingCount ||
          (before.lastSyncAt?.getTime() ?? null) !== (lastSyncAt?.getTime() ?? null);
        if (!changed) return;
        const trips = await tx.trip.findMany({
          where: {
            vehicleId: actor.vehicleId,
            status: { not: "CANCELLED" },
            planningDay: { date: dateOnly(colomboLocal(now.getTime()).date) },
          },
          select: { id: true, planningDay: { select: { depot: true } } },
        });
        if (trips.length === 0) return;
        await appendFeed(
          tx,
          trips.map((trip) => ({
            kind: "run_updated" as const,
            entity: { type: "trip", id: trip.id },
            audience: {
              roles: ["DISPATCHER", "LOADER", "DRIVER"] as const,
              depot: trip.planningDay.depot,
              vehicleId: actor.vehicleId,
            },
          })),
        );
      });
      const hint = await readFeedHint(prisma);
      return { serverTime: now.toISOString(), feedHead: hint.head, resetEpoch: hint.resetEpoch };
    },
  );
};
