import type { ApiDtoInput, EventPayloadMap, OrderDto } from "@nextdrop/contracts";
import {
  aggregateOrderQuantities,
  applyEvent,
  deliveryDateFor,
  emptyOrderState,
  reduceOrder,
  type OrderEvent,
} from "@nextdrop/rules";
import {
  Prisma,
  type Brand,
  type OrderStatus,
  type PrismaClient,
  type Role,
  type TempRequirement,
} from "../../generated/prisma/client";
import { ApiHttpError, notFound } from "../../lib/errors";
import { linkArrivedBlobs } from "../blobs";
import { appendFeed, type FeedRowInput } from "../feed";
import type { Notifier } from "../notifications";
import { dateOnly, type CalendarSource } from "./calendar";
import { appendServerEvent, toRulesEvent } from "./events";
import { orderInclude, toOrderDto, type OrderRecord } from "./projection";

export interface OrderCommandDependencies {
  prisma: PrismaClient;
  now: () => Date;
  calendar: CalendarSource;
  notifier: Notifier;
}

export interface StoreActorRef {
  userId: string;
  outletId: string;
}

const TX = { maxWait: 5_000, timeout: 10_000 } as const;
/** Transaction-scoped advisory lock key for allocating `ORD#####` display IDs. */
const DISPLAY_ID_LOCK = 4_200_001;
const FIRST_DISPLAY_NUMBER = 10_001;

const invalid = (messageKey: string, params: Record<string, string | number | boolean> = {}) =>
  new ApiHttpError(422, "VALIDATION_FAILED", messageKey, params);
const illegal = (params: Record<string, string>) =>
  new ApiHttpError(409, "ILLEGAL_TRANSITION", "orders.illegalTransition", params);

/** One feed row per order change, visible to everyone whose scope covers the order (ADR 0029). */
export function orderChanged(order: {
  id: string;
  outletId: string;
  depot: string;
  vehicleId: string | null;
}): FeedRowInput {
  return {
    kind: "order_changed",
    entity: { type: "order", id: order.id },
    audience: {
      roles: order.vehicleId ? ["STORE", "DISPATCHER", "LOADER", "DRIVER"] : ["STORE", "DISPATCHER", "LOADER"],
      outletId: order.outletId,
      depot: order.depot,
      vehicleId: order.vehicleId,
    },
  };
}

export interface NewOrder {
  outletId: string;
  depot: string;
  brand: Brand;
  tempRequirement: TempRequirement;
  requestedDate: string;
  currentDate: string;
  status: OrderStatus;
  placedAt: Date;
  idempotencyKey: string;
  replacesOrderId: string | null;
  lines: {
    productId: string;
    sku: string;
    qtyOrdered: number;
    unitWeightKg: Prisma.Decimal;
    unitVolumeM3: Prisma.Decimal;
  }[];
  actor: { userId: string; role: Role };
}

/**
 * Insert an order with its lines and `ORDER_PLACED` inside the caller's transaction, allocating the next `ORD#####`
 * under an advisory lock. Totals come from `rules.aggregateOrderQuantities`. Returns the feed row for the caller to
 * append last. Used by store placement and by server-authored follow-up orders (backorders, ADR 0026).
 */
export async function insertOrder(
  tx: Prisma.TransactionClient,
  input: NewOrder,
): Promise<{ id: string; displayId: string; feed: FeedRowInput }> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DISPLAY_ID_LOCK})`;
  const last = await tx.order.findFirst({
    where: { displayId: { startsWith: "ORD" } },
    orderBy: { displayId: "desc" },
    select: { displayId: true },
  });
  const lastNumber = last ? Number.parseInt(last.displayId.slice(3), 10) : Number.NaN;
  const displayNumber = Number.isFinite(lastNumber)
    ? Math.max(lastNumber + 1, FIRST_DISPLAY_NUMBER)
    : FIRST_DISPLAY_NUMBER;
  const totals = aggregateOrderQuantities(input.lines);
  const skuByProduct = new Map(input.lines.map((line) => [line.productId, line.sku]));
  const order = await tx.order.create({
    data: {
      displayId: `ORD${displayNumber}`,
      brand: input.brand,
      tempRequirement: input.tempRequirement,
      requestedDate: dateOnly(input.requestedDate),
      currentDate: dateOnly(input.currentDate),
      status: input.status,
      weightG: totals.weightG,
      volumeL: totals.volumeL,
      placedAt: input.placedAt,
      idempotencyKey: input.idempotencyKey,
      outletId: input.outletId,
      replacesOrderId: input.replacesOrderId,
      orderLine_orderId: { create: input.lines.map(({ sku: _sku, ...line }) => line) },
    },
    include: { orderLine_orderId: { select: { id: true, productId: true, qtyOrdered: true } } },
  });
  const payload: EventPayloadMap["ORDER_PLACED"] = {
    lines: order.orderLine_orderId.map((line) => ({
      lineId: line.id,
      skuId: skuByProduct.get(line.productId)!,
      qty: line.qtyOrdered,
    })),
    requestedDate: input.requestedDate,
    ...(input.replacesOrderId ? { replacesOrderId: input.replacesOrderId } : {}),
  };
  await appendServerEvent(tx, {
    type: "ORDER_PLACED",
    payload,
    orderId: order.id,
    actor: input.actor,
    at: input.placedAt,
  });
  return {
    id: order.id,
    displayId: order.displayId,
    feed: orderChanged({ id: order.id, outletId: input.outletId, depot: input.depot, vehicleId: null }),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function createOrderCommands(deps: OrderCommandDependencies) {
  const { prisma } = deps;
  const load = (where: Prisma.OrderWhereUniqueInput) => prisma.order.findUnique({ where, include: orderInclude });

  async function reload(id: string): Promise<OrderDto> {
    const order = await load({ id });
    if (!order) throw notFound();
    return toOrderDto(order);
  }

  /** `POST /store/orders`: one order per temperature, target date from the rules calendar, idempotent per outlet. */
  async function place(
    actor: StoreActorRef,
    body: ApiDtoInput<"createOrderRequest">,
    idempotencyKey: string,
  ): Promise<OrderDto> {
    const key = `${actor.outletId}:${idempotencyKey}`;
    const replay = await load({ idempotencyKey: key });
    if (replay) return toOrderDto(replay);

    const productIds = body.lines.map((line) => line.productId);
    if (new Set(productIds).size !== productIds.length) throw invalid("orders.duplicateProduct");
    const [outlet, products] = await Promise.all([
      prisma.outlet.findUniqueOrThrow({ where: { id: actor.outletId }, select: { brand: true, depot: true } }),
      prisma.product.findMany({ where: { id: { in: productIds } } }),
    ]);
    const byId = new Map(products.map((p) => [p.id, p]));
    const missing = productIds.find((id) => !byId.has(id));
    if (missing) throw invalid("orders.unknownProduct", { productId: missing });
    // An order row carries one brand and one temperature: a mixed basket is two orders (dry and chilled).
    if (products.some((p) => p.brand !== outlet.brand)) throw invalid("orders.wrongBrand", { brand: outlet.brand });
    const temps = new Set(products.map((p) => p.tempRequirement));
    if (temps.size > 1) throw invalid("orders.mixedTemperature");
    const tempRequirement = products[0]!.tempRequirement;
    if (body.replacesOrderId) {
      const replaced = await prisma.order.count({ where: { id: body.replacesOrderId, outletId: actor.outletId } });
      if (replaced === 0) throw invalid("orders.unknownReplacedOrder");
    }

    const now = deps.now();
    const currentDate = deliveryDateFor(body.requestedDate, now.getTime(), await deps.calendar.get());
    const lines = body.lines.map((line) => {
      const product = byId.get(line.productId)!;
      return {
        productId: product.id,
        sku: product.sku,
        qtyOrdered: line.qty,
        unitWeightKg: product.unitWeightKg,
        unitVolumeM3: product.unitVolumeM3,
      };
    });
    const placedEvent = {
      id: "pending",
      type: "ORDER_PLACED",
      subject: {},
      payload: { requestedDate: body.requestedDate, replacesOrderId: body.replacesOrderId },
    } satisfies OrderEvent;
    const status = applyEvent(emptyOrderState("pending"), placedEvent).state.status!;

    try {
      const id = await prisma.$transaction(async (tx) => {
        const placed = await insertOrder(tx, {
          outletId: actor.outletId,
          depot: outlet.depot,
          brand: outlet.brand,
          tempRequirement,
          requestedDate: body.requestedDate,
          currentDate,
          status,
          placedAt: now,
          idempotencyKey: key,
          replacesOrderId: body.replacesOrderId ?? null,
          lines,
          actor: { userId: actor.userId, role: "STORE" },
        });
        await appendFeed(tx, [placed.feed]);
        return placed.id;
      }, TX);
      return reload(id);
    } catch (error) {
      // A concurrent retry with the same key committed first: return its order.
      if (isUniqueViolation(error)) {
        const winner = await load({ idempotencyKey: key });
        if (winner) return toOrderDto(winner);
      }
      throw error;
    }
  }

  interface Transition<T extends "ORDER_CANCELLED" | "RECEIPT_CONFIRMED" | "ISSUE_REPORTED"> {
    type: T;
    payload: EventPayloadMap[T];
    /**
     * Record the event even when the reducer keeps the status (a late or repeated fact). True for issues: a second
     * issue, or one after receipt, is still a dispute to handle. Cancel and receipt refuse a no-op repeat instead.
     */
    recordWithoutChange?: boolean;
    /** Extra writes in the same transaction, before the feed rows; may return notification feed rows. */
    also?: (tx: Prisma.TransactionClient, order: OrderRecord, eventId: string) => Promise<FeedRowInput[]>;
  }

  /**
   * Append one server event and move `orders.status` through `rules.applyEvent`, in one transaction with the feed
   * rows last. The status update is a compare-and-set on the status the reducer started from.
   */
  async function transition<T extends "ORDER_CANCELLED" | "RECEIPT_CONFIRMED" | "ISSUE_REPORTED">(
    orderId: string,
    actor: StoreActorRef,
    change: Transition<T>,
  ): Promise<{ order: OrderDto; eventId: string }> {
    const order = await load({ id: orderId });
    if (!order) throw notFound();
    const state = reduceOrder(order.id, order.orderEvent_orderId.map(toRulesEvent));
    const next = applyEvent(state, {
      id: "pending",
      type: change.type,
      subject: { orderId },
      payload: change.payload,
    } as OrderEvent);
    const kind = next.outcome.kind;
    if (kind === "ILLEGAL_TRANSITION" || (kind === "IGNORED_EARLIER_STAGE" && !change.recordWithoutChange)) {
      throw illegal({ from: order.status, event: change.type });
    }
    const status = next.state.status ?? order.status;
    const now = deps.now();
    const eventId = await prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({ where: { id: orderId, status: order.status }, data: { status } });
      if (count === 0) throw new ApiHttpError(409, "ILLEGAL_TRANSITION", "orders.changedConcurrently");
      const event = await appendServerEvent(tx, {
        type: change.type,
        payload: change.payload,
        orderId,
        actor: { userId: actor.userId, role: "STORE" },
        at: now,
      });
      // A referenced photo that already arrived is linked to the event (spec/sync/blobs.md).
      await linkArrivedBlobs(tx, event.id, change.payload);
      const extra = (await change.also?.(tx, order, event.id)) ?? [];
      const vehicleId =
        (
          await tx.tripStop.findFirst({
            where: { orderId, tripStatus: { not: "CANCELLED" } },
            select: { trip: { select: { vehicleId: true } } },
          })
        )?.trip.vehicleId ?? null;
      await appendFeed(tx, [
        orderChanged({ id: orderId, outletId: order.outletId, depot: order.outlet.depot, vehicleId }),
        ...extra,
      ]);
      return event.id;
    }, TX);
    return { order: await reload(orderId), eventId };
  }

  function knownLines(order: OrderRecord, lineIds: readonly string[]) {
    const ids = new Set(order.orderLine_orderId.map((line) => line.id));
    if (new Set(lineIds).size !== lineIds.length) throw invalid("orders.duplicateLine");
    const unknown = lineIds.find((id) => !ids.has(id));
    if (unknown) throw invalid("orders.unknownLine", { lineId: unknown });
  }

  return {
    place,

    async cancel(orderId: string, actor: StoreActorRef, payload: ApiDtoInput<"cancelOrderRequest">) {
      return (await transition(orderId, actor, { type: "ORDER_CANCELLED", payload })).order;
    },

    async confirmReceipt(orderId: string, actor: StoreActorRef, payload: ApiDtoInput<"receiptRequest">) {
      const order = await load({ id: orderId });
      if (!order) throw notFound();
      knownLines(
        order,
        payload.lines.map((line) => line.lineId),
      );
      return (
        await transition(orderId, actor, {
          type: "RECEIPT_CONFIRMED",
          payload,
          also: async (tx) => {
            for (const line of payload.lines) {
              await tx.orderLine.update({ where: { id: line.lineId }, data: { qtyReceived: line.qtyReceived } });
            }
            return [];
          },
        })
      ).order;
    },

    /** ISSUE_REPORTED: the event id is the issue id (ADR 0024); the dispatchers of the outlet's depot are notified. */
    async reportIssue(orderId: string, actor: StoreActorRef, payload: ApiDtoInput<"reportIssueRequest">) {
      const order = await load({ id: orderId });
      if (!order) throw notFound();
      knownLines(
        order,
        (payload.lines ?? []).map((line) => line.lineId),
      );
      const { order: dto, eventId } = await transition(orderId, actor, {
        type: "ISSUE_REPORTED",
        payload,
        recordWithoutChange: true,
        also: (tx, current, issueId) =>
          deps.notifier.notify(tx, {
            kind: "dispute_opened",
            audience: { role: "DISPATCHER", depot: current.outlet.depot },
            params: { order: current.displayId, issueKind: payload.kind },
            entity: { type: "issue", id: issueId },
          }),
      });
      return { issueId: eventId, order: dto };
    },
  };
}

export type OrderCommands = ReturnType<typeof createOrderCommands>;
