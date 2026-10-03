import {
  cancelOrderRequestSchema,
  createOrderRequestSchema,
  cutoffResponseSchema,
  dateQuerySchema,
  deliveriesResponseSchema,
  idParamsSchema,
  issueCreatedResponseSchema,
  mutationHeadersSchema,
  orderCreateHeadersSchema,
  orderDetailSchema,
  orderListQuerySchema,
  orderSchema,
  ordersResponseSchema,
  receiptRequestSchema,
  reportIssueRequestSchema,
} from "@nextdrop/contracts";
import { cutoffAt, deliveryDateFor, nextOperatingDate, orderingGuidance } from "@nextdrop/rules";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { ApiHttpError, forbidden, notFound } from "../../lib/errors";
import { collectionResource, scoped, type Actor, type ResourceResolver } from "../policy";
import { dateOnly, type CalendarSource } from "./calendar";
import type { OrderCommands } from "./commands";
import { toEnvelope } from "./events";
import { orderInclude, toOrderDto, toTripDto, tripInclude } from "./projection";

export interface OrderRouteDependencies {
  prisma: PrismaClient;
  now: () => Date;
  calendar: CalendarSource;
  commands: OrderCommands;
}

/** `NO_SIGNAL_AFTER_MIN` (spec/assumptions.md): a departed run silent this long shows "No signal". */
export const NO_SIGNAL_AFTER_MIN = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 20;

function storeActor(request: FastifyRequest): Extract<Actor, { role: "STORE" }> {
  const actor = request.actor;
  if (actor?.role !== "STORE") throw forbidden();
  return actor;
}

/** Ownership columns of the order in `:id`, for `can()`. */
export function orderResource(prisma: PrismaClient): ResourceResolver {
  return async (request) => {
    const { id } = request.params as { id: string };
    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        outletId: true,
        outlet: { select: { depot: true } },
        tripStop_orderId: {
          where: { tripStatus: { not: "CANCELLED" } },
          select: { trip: { select: { vehicleId: true } } },
        },
      },
    });
    if (!order) throw notFound();
    return {
      kind: "order",
      outletId: order.outletId,
      depot: order.outlet.depot,
      vehicleIds: order.tripStop_orderId.map((stop) => stop.trip.vehicleId),
    };
  };
}

/** The store order endpoints of spec/platform/api.md. */
export const orderRoutes: FastifyPluginAsyncZod<OrderRouteDependencies> = async (app, deps) => {
  const { prisma, commands } = deps;
  const ownOrder = orderResource(prisma);

  app.get(
    "/api/store/cutoff",
    {
      schema: { querystring: dateQuerySchema, response: { 200: cutoffResponseSchema } },
      config: { policy: { action: "storeCutoff", resourceResolver: collectionResource } },
    },
    async (request) => {
      const actor = storeActor(request);
      const now = deps.now();
      const calendar = await deps.calendar.get();
      const requested = request.query.date;
      const deliveryDate = deliveryDateFor(requested, now.getTime(), calendar);
      const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: actor.outletId }, select: { brand: true } });
      return {
        serverTime: now.toISOString(),
        requestedDate: requested,
        deliveryDate,
        cutoffAt: new Date(cutoffAt(deliveryDate)).toISOString(),
        // Still in time for the requested date (or the operating date it rolls to).
        orderingOpen: deliveryDate === nextOperatingDate(requested, calendar),
        guidanceKey: orderingGuidance(outlet.brand, requested, calendar),
      };
    },
  );

  app.get(
    "/api/store/deliveries",
    {
      schema: { querystring: dateQuerySchema, response: { 200: deliveriesResponseSchema } },
      config: { policy: { action: "storeDeliveries", resourceResolver: collectionResource } },
    },
    async (request) => {
      const actor = storeActor(request);
      const now = deps.now();
      const orders = await prisma.order.findMany({
        where: { AND: [scoped(actor).orders, { currentDate: dateOnly(request.query.date) }] },
        include: orderInclude,
        orderBy: { id: "asc" },
      });
      const tripIds = [...new Set(orders.flatMap((o) => o.tripStop_orderId.map((s) => s.tripId)))];
      const trips = await prisma.trip.findMany({
        where: { id: { in: tripIds } },
        include: tripInclude(actor.outletId),
      });
      const devices = await prisma.device.findMany({
        where: { user: { role: "DRIVER", vehicleId: { in: trips.map((t) => t.vehicleId) } } },
        select: { lastSeenAt: true, user: { select: { vehicleId: true } } },
      });
      const lastHeard = new Map<string, Date>();
      for (const device of devices) {
        const vehicleId = device.user.vehicleId!;
        const seen = lastHeard.get(vehicleId);
        if (!seen || device.lastSeenAt > seen) lastHeard.set(vehicleId, device.lastSeenAt);
      }
      const tripById = new Map(trips.map((t) => [t.id, t]));
      return {
        items: orders.map((order) => {
          const trip = tripById.get(order.tripStop_orderId[0]?.tripId ?? "");
          const heard = trip ? (lastHeard.get(trip.vehicleId) ?? null) : null;
          const silent =
            trip?.status === "DEPARTED" &&
            (heard === null || now.getTime() - heard.getTime() > NO_SIGNAL_AFTER_MIN * 60_000);
          return {
            order: toOrderDto(order),
            trip: trip ? toTripDto(trip) : null,
            signal: silent ? ("NO_SIGNAL" as const) : ("ONLINE" as const),
            lastHeardAt: heard?.toISOString() ?? null,
          };
        }),
        serverTime: now.toISOString(),
      };
    },
  );

  app.post(
    "/api/store/orders",
    {
      schema: { headers: orderCreateHeadersSchema, body: createOrderRequestSchema, response: { 201: orderSchema } },
      config: { policy: { action: "createOrder", resourceResolver: collectionResource } },
    },
    async (request, reply) => {
      const actor = storeActor(request);
      const order = await commands.place(actor, request.body, request.headers["idempotency-key"]);
      return reply.code(201).send(order);
    },
  );

  app.get(
    "/api/store/orders",
    {
      schema: { querystring: orderListQuerySchema, response: { 200: ordersResponseSchema } },
      config: { policy: { action: "storeOrders", resourceResolver: collectionResource } },
    },
    async (request) => {
      const actor = storeActor(request);
      const { date, status, after } = request.query;
      if (after !== undefined && !UUID.test(after)) {
        throw new ApiHttpError(400, "SCHEMA_INVALID", "errors.schemaInvalid", { field: "after" });
      }
      const filters: Prisma.OrderWhereInput[] = [scoped(actor).orders];
      if (date) filters.push({ currentDate: dateOnly(date) });
      if (status) filters.push({ status });
      if (after) filters.push({ id: { lt: after } });
      const limit = request.query.limit ?? DEFAULT_LIMIT;
      // Newest first by UUIDv7 id; `after` is the last id of the previous page.
      const rows = await prisma.order.findMany({
        where: { AND: filters },
        include: orderInclude,
        orderBy: { id: "desc" },
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      return { items: page.map(toOrderDto), nextCursor: rows.length > limit ? page[page.length - 1]!.id : null };
    },
  );

  app.get(
    "/api/store/orders/:id",
    {
      schema: { params: idParamsSchema, response: { 200: orderDetailSchema } },
      config: { policy: { action: "storeOrder", resourceResolver: ownOrder } },
    },
    async (request) => {
      const order = await prisma.order.findUnique({ where: { id: request.params.id }, include: orderInclude });
      if (!order) throw notFound();
      return { order: toOrderDto(order), timeline: order.orderEvent_orderId.map(toEnvelope) };
    },
  );

  app.post(
    "/api/store/orders/:id/cancel",
    {
      schema: {
        params: idParamsSchema,
        headers: mutationHeadersSchema,
        body: cancelOrderRequestSchema,
        response: { 200: orderSchema },
      },
      config: { policy: { action: "cancelOrder", resourceResolver: ownOrder } },
    },
    async (request) => commands.cancel(request.params.id, storeActor(request), request.body),
  );

  app.post(
    "/api/store/orders/:id/receipt",
    {
      schema: {
        params: idParamsSchema,
        headers: mutationHeadersSchema,
        body: receiptRequestSchema,
        response: { 200: orderSchema },
      },
      config: { policy: { action: "receipt", resourceResolver: ownOrder } },
    },
    async (request) => commands.confirmReceipt(request.params.id, storeActor(request), request.body),
  );

  app.post(
    "/api/store/orders/:id/issues",
    {
      schema: {
        params: idParamsSchema,
        headers: mutationHeadersSchema,
        body: reportIssueRequestSchema,
        response: { 201: issueCreatedResponseSchema },
      },
      config: { policy: { action: "reportIssue", resourceResolver: ownOrder } },
    },
    async (request, reply) =>
      reply.code(201).send(await commands.reportIssue(request.params.id, storeActor(request), request.body)),
  );
};
