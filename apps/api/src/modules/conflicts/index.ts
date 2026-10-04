// Sync conflict resolution (spec/sync/recovery-and-conflicts.md §9.5, ADR 0040): the dispatcher accepts or rejects a
// held field fact. Resolution is always by the dispatcher; nothing here runs on its own.
import {
  ackResponseSchema,
  idParamsSchema,
  mutationHeadersSchema,
  resolveConflictRequestSchema,
  type ApiDtoInput,
} from "@nextdrop/contracts";
import { reduceOrder, type OrderEvent } from "@nextdrop/rules";
import type { FastifyInstance } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { ApiHttpError, forbidden, notFound } from "../../lib/errors";
import { appendFeed, type FeedRowInput } from "../feed";
import { isDelivering, projectFact } from "../field";
import { createNotifier, type Notifier } from "../notifications";
import { appendServerEvent, orderChanged, orderInclude, toRulesEvent } from "../orders";
import type { ResourceResolver } from "../policy";

type Resolution = ApiDtoInput<"resolveConflictRequest">;

const TX = { maxWait: 5_000, timeout: 10_000 } as const;
const MAX_ATTEMPTS = 3;
/** Another writer moved the order between read and write: retry. */
class LostRace extends Error {}

export interface ConflictDependencies {
  prisma: PrismaClient;
  now: () => Date;
  notifier: Notifier;
}

export function createConflicts(deps: ConflictDependencies) {
  const { prisma, notifier } = deps;

  async function resolveOnce(actor: { userId: string }, conflictId: string, body: Resolution) {
    const conflict = await prisma.conflict.findUnique({
      where: { id: conflictId },
      include: { heldEvent: { include: { actorUser: { select: { role: true, depot: true, vehicleId: true } } } } },
    });
    if (!conflict) throw notFound();
    if (conflict.state === "RESOLVED") {
      // Retrying the same decision is a no-op; changing a decision is not allowed.
      if (conflict.resolution === body.resolution) return;
      throw new ApiHttpError(409, "ILLEGAL_TRANSITION", "conflicts.alreadyResolved", {
        resolution: conflict.resolution ?? "",
      });
    }
    if (!conflict.orderId) throw notFound();
    const order = await prisma.order.findUniqueOrThrow({ where: { id: conflict.orderId }, include: orderInclude });
    const held = conflict.heldEvent;
    const now = deps.now();
    const payload = {
      conflictId,
      resolution: body.resolution,
      heldEventId: held.id,
      ...(body.note === undefined ? {} : { note: body.note }),
    };
    // The order after the decision: the reducer applies an accepted fact (forced), and leaves a rejected one inert.
    const after = reduceOrder(order.id, [
      ...order.orderEvent_orderId.map(toRulesEvent),
      { id: "pending", type: "CONFLICT_RESOLVED", subject: { orderId: order.id }, payload } as OrderEvent,
    ]);
    const status = after.status ?? order.status;
    const accepted = body.resolution === "ACCEPT_FACT";
    const heldPayload = toRulesEvent(held).payload;
    const delivered = accepted && status !== order.status && isDelivering(held.type, heldPayload);
    const stop = order.tripStop_orderId[0];

    await prisma.$transaction(async (tx) => {
      const closed = await tx.conflict.updateMany({
        where: { id: conflictId, state: "OPEN" },
        data: {
          state: "RESOLVED",
          resolution: body.resolution,
          note: body.note ?? null,
          resolvedAt: now,
          resolvedBy: actor.userId,
        },
      });
      if (closed.count === 0) throw new LostRace();
      const moved = await tx.order.updateMany({
        where: { id: order.id, status: order.status },
        data: { status, ...(delivered ? { confirmedAt: held.receivedAt } : {}) },
      });
      if (moved.count === 0) throw new LostRace();
      await appendServerEvent(tx, {
        type: "CONFLICT_RESOLVED",
        payload,
        orderId: order.id,
        actor: { userId: actor.userId, role: "DISPATCHER" },
        at: now,
      });
      if (accepted) await projectFact(tx, order, held.type, heldPayload);

      const device = held.actorUser;
      const feed: FeedRowInput[] = [
        {
          kind: "conflict_resolved",
          entity: { type: "conflict", id: conflictId },
          audience: {
            roles: ["DISPATCHER", device.role],
            depot: order.outlet.depot,
            ...(device.role === "DRIVER" ? { vehicleId: device.vehicleId } : {}),
          },
        },
        orderChanged({
          id: order.id,
          outletId: order.outletId,
          depot: order.outlet.depot,
          vehicleId: stop?.trip.vehicleId ?? null,
        }),
      ];
      if (delivered) {
        feed.push(
          ...(await notifier.notify(tx, {
            kind: "delivered",
            audience: { role: "STORE", outletId: order.outletId },
            params: { order: order.displayId },
            entity: { type: "order", id: order.id },
          })),
        );
      }
      await appendFeed(tx, feed);
    }, TX);
  }

  return {
    async resolve(actor: { userId: string }, conflictId: string, body: Resolution) {
      for (let attempt = 1; ; attempt++) {
        try {
          await resolveOnce(actor, conflictId, body);
          return { ok: true as const, serverTime: deps.now().toISOString() };
        } catch (error) {
          // A concurrent decision or order write: re-read and decide again (a matching decision is then a retry).
          if (error instanceof LostRace && attempt < MAX_ATTEMPTS) continue;
          if (error instanceof LostRace) throw new ApiHttpError(409, "REVISION_CONFLICT", "errors.revisionConflict");
          throw error;
        }
      }
    },
  };
}

export type Conflicts = ReturnType<typeof createConflicts>;

/** The conflict's depot: its order's outlet depot, else its trip's planning-day depot. */
function conflictResource(prisma: PrismaClient): ResourceResolver {
  return async (request) => {
    const { id } = request.params as { id: string };
    const conflict = await prisma.conflict.findUnique({
      where: { id },
      select: {
        order: { select: { outlet: { select: { depot: true } } } },
        trip: { select: { planningDay: { select: { depot: true } } } },
      },
    });
    const depot = conflict?.order?.outlet.depot ?? conflict?.trip?.planningDay.depot;
    if (!depot) throw notFound();
    return { kind: "depot", depot };
  };
}

const conflictRoutes: FastifyPluginAsyncZod<{ prisma: PrismaClient; conflicts: Conflicts }> = async (app, deps) => {
  app.post(
    "/api/dispatch/conflicts/:id/resolve",
    {
      schema: {
        params: idParamsSchema,
        headers: mutationHeadersSchema,
        body: resolveConflictRequestSchema,
        response: { 200: ackResponseSchema },
      },
      config: { policy: { action: "resolveConflict", resourceResolver: conflictResource(deps.prisma) } },
    },
    async (request) => {
      const actor = request.actor;
      if (actor?.role !== "DISPATCHER") throw forbidden();
      return deps.conflicts.resolve(actor, request.params.id, request.body);
    },
  );
};

export async function registerConflicts(app: FastifyInstance, deps: { prisma: PrismaClient | null; now: () => Date }) {
  if (!deps.prisma) return;
  const conflicts = createConflicts({ prisma: deps.prisma, now: deps.now, notifier: createNotifier() });
  await app.register(conflictRoutes, { prisma: deps.prisma, conflicts });
}
