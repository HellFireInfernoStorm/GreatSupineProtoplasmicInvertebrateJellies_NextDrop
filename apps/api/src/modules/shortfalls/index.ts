// Dock shortfall resolution (ADR 0005, ADR 0026): the dispatcher resolves each LOAD_SHORT line.
import {
  mutationHeadersSchema,
  orderLineParamsSchema,
  resolveShortRequestSchema,
  resolveShortResponseSchema,
  type ApiDto,
  type ApiDtoInput,
} from "@nextdrop/contracts";
import { applyEvent, emptyOrderState, nextOperatingDate, reduceOrder, type OrderEvent } from "@nextdrop/rules";
import type { FastifyInstance } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { ApiHttpError, forbidden, notFound } from "../../lib/errors";
import { appendFeed, type FeedRowInput } from "../feed";
import { createNotifier, type Notifier } from "../notifications";
import {
  appendServerEvent,
  createCalendarSource,
  insertOrder,
  localDateOf,
  orderChanged,
  orderInclude,
  orderResource,
  toOrderDto,
  toRulesEvent,
  type CalendarSource,
} from "../orders";

export interface ShortfallDependencies {
  prisma: PrismaClient;
  now: () => Date;
  calendar: CalendarSource;
  notifier: Notifier;
}

const TX = { maxWait: 5_000, timeout: 10_000 } as const;
type Outcome = ApiDtoInput<"resolveShortRequest">["outcome"];
/** SHIP_PARTIAL and BACKORDER are final; HOLD_TRIP may be re-resolved to either (ADR 0026). */
const FINAL: ReadonlySet<Outcome> = new Set(["SHIP_PARTIAL", "BACKORDER"]);

export const backorderKey = (orderId: string, lineId: string) => `backorder:${orderId}:${lineId}`;

export function createShortfalls(deps: ShortfallDependencies) {
  const { prisma } = deps;
  const load = (where: Prisma.OrderWhereUniqueInput) => prisma.order.findUnique({ where, include: orderInclude });

  async function respond(orderId: string, backorderId: string | null): Promise<ApiDto<"resolveShortResponse">> {
    const order = await load({ id: orderId });
    if (!order) throw notFound();
    const backorder = backorderId ? await load({ id: backorderId }) : null;
    return {
      order: toOrderDto(order),
      backorder: backorder ? toOrderDto(backorder) : null,
      serverTime: deps.now().toISOString(),
    };
  }

  async function resolveOnce(
    actor: { userId: string },
    orderId: string,
    lineId: string,
    body: ApiDtoInput<"resolveShortRequest">,
  ): Promise<ApiDto<"resolveShortResponse">> {
    const order = await load({ id: orderId });
    if (!order) throw notFound();
    const state = reduceOrder(order.id, order.orderEvent_orderId.map(toRulesEvent));
    const short = state.short.find((line) => line.lineId === lineId);
    if (!short) throw new ApiHttpError(404, "NOT_FOUND", "shortfalls.noShortLine", { lineId });
    const current = short.resolution;
    const key = backorderKey(orderId, lineId);

    // Retrying the same decision returns the current state without new events.
    if (current === body.outcome) {
      const existing =
        body.outcome === "BACKORDER" ? await prisma.order.findUnique({ where: { idempotencyKey: key } }) : null;
      return respond(orderId, existing?.id ?? null);
    }
    if (current !== null && FINAL.has(current)) {
      throw new ApiHttpError(409, "ILLEGAL_TRANSITION", "shortfalls.alreadyResolved", { resolution: current });
    }

    const now = deps.now();
    const line = order.orderLine_orderId.find((l) => l.id === lineId);
    const assigned = order.tripStop_orderId[0];
    const backorderDate =
      body.outcome === "BACKORDER"
        ? nextOperatingDate(localDateOf(order.currentDate), await deps.calendar.get())
        : null;

    const backorderId = await prisma.$transaction(async (tx) => {
      await appendServerEvent(tx, {
        type: "SHORT_RESOLVED",
        payload: { orderId, lineId, outcome: body.outcome, ...(body.note === undefined ? {} : { note: body.note }) },
        orderId,
        actor: { userId: actor.userId, role: "DISPATCHER" },
        at: now,
      });
      const feed: FeedRowInput[] = [
        orderChanged({
          id: orderId,
          outletId: order.outletId,
          depot: order.outlet.depot,
          vehicleId: assigned?.trip.vehicleId ?? null,
        }),
      ];
      if (assigned) {
        // The loader's ready gate may have changed: hint the run (ADR 0005).
        feed.push({
          kind: "run_updated",
          entity: { type: "trip", id: assigned.tripId },
          audience: {
            roles: ["DISPATCHER", "LOADER", "DRIVER"],
            depot: order.outlet.depot,
            vehicleId: assigned.trip.vehicleId,
          },
        });
      }
      let created: string | null = null;
      if (body.outcome === "BACKORDER" && line && backorderDate) {
        // The missing quantity as a follow-up order. Store cutoff does not apply to this server-authored order.
        const placed = applyEvent(emptyOrderState("pending"), {
          id: "pending",
          type: "ORDER_PLACED",
          subject: {},
          payload: { requestedDate: backorderDate, replacesOrderId: orderId },
        } satisfies OrderEvent).state.status!;
        const backorder = await insertOrder(tx, {
          outletId: order.outletId,
          depot: order.outlet.depot,
          brand: order.brand,
          tempRequirement: order.tempRequirement,
          requestedDate: backorderDate,
          currentDate: backorderDate,
          status: placed,
          placedAt: now,
          idempotencyKey: key,
          replacesOrderId: orderId,
          lines: [
            {
              productId: line.productId,
              sku: line.product.sku,
              qtyOrdered: short.qtyShort,
              unitWeightKg: line.unitWeightKg,
              unitVolumeM3: line.unitVolumeM3,
            },
          ],
          actor: { userId: actor.userId, role: "DISPATCHER" },
        });
        feed.push(backorder.feed);
        created = backorder.id;
      }
      feed.push(
        ...(await deps.notifier.notify(tx, {
          kind: "short_resolved",
          audience: { role: "STORE", outletId: order.outletId },
          params: { order: order.displayId, outcome: body.outcome },
          entity: { type: "order", id: orderId },
        })),
      );
      await appendFeed(tx, feed);
      return created;
    }, TX);
    return respond(orderId, backorderId);
  }

  return {
    async resolve(
      actor: { userId: string },
      orderId: string,
      lineId: string,
      body: ApiDtoInput<"resolveShortRequest">,
    ) {
      try {
        return await resolveOnce(actor, orderId, lineId, body);
      } catch (error) {
        // A concurrent identical decision committed first (the backorder key is unique): answer as a retry.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return resolveOnce(actor, orderId, lineId, body);
        }
        throw error;
      }
    },
  };
}

export type Shortfalls = ReturnType<typeof createShortfalls>;

const shortfallRoutes: FastifyPluginAsyncZod<{ prisma: PrismaClient; shortfalls: Shortfalls }> = async (app, deps) => {
  app.post(
    "/api/dispatch/orders/:id/shorts/:lineId/resolve",
    {
      schema: {
        params: orderLineParamsSchema,
        headers: mutationHeadersSchema,
        body: resolveShortRequestSchema,
        response: { 200: resolveShortResponseSchema },
      },
      config: { policy: { action: "resolveShort", resourceResolver: orderResource(deps.prisma) } },
    },
    async (request) => {
      const actor = request.actor;
      if (actor?.role !== "DISPATCHER") throw forbidden();
      return deps.shortfalls.resolve(actor, request.params.id, request.params.lineId, request.body);
    },
  );
};

export async function registerShortfalls(app: FastifyInstance, deps: { prisma: PrismaClient | null; now: () => Date }) {
  if (!deps.prisma) return;
  const shortfalls = createShortfalls({
    prisma: deps.prisma,
    now: deps.now,
    calendar: createCalendarSource(deps.prisma),
    notifier: createNotifier(),
  });
  await app.register(shortfallRoutes, { prisma: deps.prisma, shortfalls });
}
