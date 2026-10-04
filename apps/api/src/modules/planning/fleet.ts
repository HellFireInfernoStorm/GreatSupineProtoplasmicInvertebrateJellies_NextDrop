// Fleet commands (ADR 0017). Availability and its audit event commit together; proposals use existing rules.
import {
  fleetResponseSchema,
  mutationHeadersSchema,
  SCHEMA_VERSION,
  updateFleetRequestSchema,
} from "@nextdrop/contracts";
import { isoWeekOf } from "@nextdrop/rules";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { PrismaClient } from "../../generated/prisma/client";
import type { Clock } from "../../lib/clock";
import { forbidden, notFound } from "../../lib/errors";
import { appendFeed, type FeedRowInput } from "../feed";
import { dateOnly } from "../orders";
import { can, collectionResource, scoped } from "../policy";
import { toVehicleDto, vehicleInclude } from "../reference";

export const fleetRoutes: FastifyPluginAsyncZod<{ prisma: PrismaClient; clock: Clock }> = async (
  app,
  { prisma, clock },
) => {
  app.put(
    "/api/dispatch/fleet",
    {
      schema: {
        headers: mutationHeadersSchema,
        body: updateFleetRequestSchema,
        response: { 200: fleetResponseSchema },
      },
      config: { policy: { action: "updateFleet", resourceResolver: collectionResource } },
    },
    async (request) => {
      const actor = request.actor;
      if (actor?.role !== "DISPATCHER") throw forbidden();
      const { changes } = request.body;
      // The response is the scoped fleet for the first requested date; all requested dates are committed atomically.
      const date = changes[0]!.date;
      return prisma.$transaction(
        async (tx) => {
          const vehicles = await tx.vehicle.findMany({
            where: { id: { in: changes.map((change) => change.vehicleId) } },
          });
          const byId = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
          for (const change of changes) {
            const vehicle = byId.get(change.vehicleId);
            if (!vehicle) throw notFound();
            if (!can(actor, "updateFleet", { kind: "vehicle", vehicleId: vehicle.id, depot: vehicle.depot }))
              throw forbidden();
          }
          // Share publish's depot/week lock: a concurrent publish must validate either before or after this command.
          const locks = new Set(
            changes.map((change) => {
              const week = isoWeekOf(change.date);
              return `publish:${byId.get(change.vehicleId)!.depot}:${week.isoYear}-${week.isoWeek}`;
            }),
          );
          for (const lockKey of [...locks].sort()) {
            await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${lockKey}))) AS locked`;
          }
          const at = clock.now();
          const feed: FeedRowInput[] = [];
          for (const change of changes) {
            const key = { vehicleId: change.vehicleId, date: dateOnly(change.date) };
            const current = await tx.vehicleAvailability.findUnique({ where: { vehicleId_date: key } });
            const fields = { status: change.status, reason: change.reason, note: change.note ?? null };
            if (
              current &&
              current.status === fields.status &&
              current.reason === fields.reason &&
              current.note === fields.note
            )
              continue;
            await tx.vehicleAvailability.upsert({
              where: { vehicleId_date: key },
              create: { ...key, ...fields, setBy: actor.userId, setAt: at },
              update: { ...fields, setBy: actor.userId, setAt: at },
            });
            await tx.orderEvent.create({
              data: {
                type: "VEHICLE_AVAILABILITY_CHANGED",
                schemaVersion: SCHEMA_VERSION,
                source: "SERVER",
                actorRole: actor.role,
                actorUserId: actor.userId,
                vehicleId: change.vehicleId,
                capturedAt: at,
                receivedAt: at,
                payload: change,
              },
            });
            feed.push({
              kind: "availability_changed",
              entity: { type: "vehicle", id: change.vehicleId },
              audience: {
                roles: ["DISPATCHER", "LOADER", "DRIVER"],
                depot: byId.get(change.vehicleId)!.depot,
                vehicleId: change.vehicleId,
              },
            });
          }
          const fleet = await tx.vehicle.findMany({
            where: scoped(actor).vehicles,
            include: { ...vehicleInclude, vehicleAvailability_vehicleId: { where: { date: dateOnly(date) } } },
            orderBy: { displayId: "asc" },
          });
          const response = {
            date,
            items: fleet.map((vehicle) => {
              const availability = vehicle.vehicleAvailability_vehicleId[0];
              return {
                vehicle: toVehicleDto(vehicle),
                availability: availability
                  ? {
                      status: availability.status,
                      reason: availability.reason,
                      note: availability.note,
                      changedAt: availability.setAt.toISOString(),
                    }
                  : { status: "AVAILABLE" as const, reason: null, note: null, changedAt: null },
              };
            }),
          };
          await appendFeed(tx, feed);
          return response;
        },
        { maxWait: 10000, timeout: 15000 },
      );
    },
  );
};
