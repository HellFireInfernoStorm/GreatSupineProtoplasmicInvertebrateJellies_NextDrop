// Seeded orders: the spec both generators produce, the events that make each order's timeline, and the writer.
// Orders are operational data: an order that already exists is never rewritten, so a restart keeps demo progress.
import { parseEventPayload, type EventPayloadMap } from "@nextdrop/contracts";
import {
  addDays,
  aggregateOrderQuantities,
  colomboInstant,
  operatingDaysBetween,
  parseClock,
  type Brand,
  type Calendar,
  type CauseKind,
  type LocalDate,
  type ReasonCode,
  type TempRequirement,
} from "@nextdrop/rules";
import { uuidv7 } from "uuidv7";
import type { Prisma, PrismaClient } from "../../src/generated/prisma/client";
import type { EventActorRole } from "../../src/generated/prisma/enums";
import { ACCOUNTS, DISPATCHER_LOGIN_ID, lookup } from "./accounts";
import { productBySku } from "./catalogue";
import { dateOnly, type ReferenceIds } from "./reference";
import type { SyncResult } from "./sync";

export interface OrderLineSpec {
  readonly sku: string;
  readonly qty: number;
}

export interface DeferralSpec {
  /** When the plan that deferred the order was published (UTC ISO). */
  readonly at: string;
  readonly toDate: LocalDate;
  readonly reasonCode: ReasonCode;
  readonly causeKind: CauseKind;
  readonly daysUnserved: number;
  readonly consecutiveDeferrals: number;
}

export interface OrderSpec {
  readonly displayId: string;
  /** Outlet display ID. */
  readonly outletId: string;
  readonly brand: Brand;
  readonly temp: TempRequirement;
  readonly lines: readonly OrderLineSpec[];
  readonly requestedDate: LocalDate;
  /** The delivery date the order now targets (`Order.currentDate`). */
  readonly deliveryDate: LocalDate;
  readonly placedAt: string;
  /** Oldest first. The last one moved the order to `deliveryDate`. */
  readonly deferrals: readonly DeferralSpec[];
}

/** A UTC ISO instant for a local Asia/Colombo date and `HH:MM`. */
export function colomboIso(date: LocalDate, hhmm: string): string {
  return new Date(colomboInstant(date, parseClock(hhmm))).toISOString();
}

/** A deferral published at `hhmm` on the evening before `fromDate`, moving the order to `toDate`. */
export function deferral(
  requestedDate: LocalDate,
  fromDate: LocalDate,
  toDate: LocalDate,
  hhmm: string,
  reasonCode: ReasonCode,
  consecutiveDeferrals: number,
  calendar: Calendar,
): DeferralSpec {
  return {
    at: colomboIso(addDays(fromDate, -1), hhmm),
    toDate,
    reasonCode,
    causeKind: "UNAVOIDABLE_POOL_EXHAUSTED",
    daysUnserved: operatingDaysBetween(requestedDate, toDate, calendar),
    consecutiveDeferrals,
  };
}

export function statusOf(spec: OrderSpec): "ORDERED" | "DEFERRED" {
  return spec.deferrals.length ? "DEFERRED" : "ORDERED";
}

export function quantitiesOf(spec: OrderSpec): { weightG: number; volumeL: number } {
  return aggregateOrderQuantities(
    spec.lines.map((l) => {
      const product = productBySku(l.sku);
      return { qtyOrdered: l.qty, unitWeightKg: product.unitWeightKg, unitVolumeM3: product.unitVolumeM3 };
    }),
  );
}

/** Orders are placed by the outlet's own account when it has one, otherwise phoned in to the dispatcher. */
export function placedByOf(spec: OrderSpec): { loginId: string; role: EventActorRole } {
  const store = ACCOUNTS.find((a) => a.role === "STORE" && a.outlet === spec.outletId);
  return store ? { loginId: store.loginId, role: "STORE" } : { loginId: DISPATCHER_LOGIN_ID, role: "DISPATCHER" };
}

export interface SeedEvent<T extends "ORDER_PLACED" | "ORDER_DEFERRED" = "ORDER_PLACED" | "ORDER_DEFERRED"> {
  readonly type: T;
  readonly at: string;
  readonly actor: { loginId: string; role: EventActorRole };
  readonly payload: EventPayloadMap[T];
}

/** The order's timeline, oldest first. `lineIds` are the stored OrderLine IDs in `spec.lines` order. */
export function eventsOf(spec: OrderSpec, lineIds: readonly string[]): SeedEvent[] {
  const placed: SeedEvent<"ORDER_PLACED"> = {
    type: "ORDER_PLACED",
    at: spec.placedAt,
    actor: placedByOf(spec),
    payload: parseEventPayload("ORDER_PLACED", {
      lines: spec.lines.map((l, i) => ({ lineId: lineIds[i], skuId: l.sku, qty: l.qty })),
      requestedDate: spec.requestedDate,
    }),
  };
  const deferred = spec.deferrals.map((d): SeedEvent<"ORDER_DEFERRED"> => ({
    type: "ORDER_DEFERRED",
    at: d.at,
    actor: { loginId: DISPATCHER_LOGIN_ID, role: "DISPATCHER" },
    payload: parseEventPayload("ORDER_DEFERRED", {
      reasonCode: d.reasonCode,
      causeKind: d.causeKind,
      scoreInputs: null,
      toDate: d.toDate,
      daysUnserved: d.daysUnserved,
      consecutiveDeferrals: d.consecutiveDeferrals,
      note: "",
      decidedBy: "DISPATCHER",
    }),
  }));
  return [placed, ...deferred];
}

export async function seedOrders(
  db: PrismaClient,
  specs: readonly OrderSpec[],
  ids: ReferenceIds,
  userIds: ReadonlyMap<string, string>,
  productIds: ReadonlyMap<string, string>,
): Promise<SyncResult> {
  const existing = new Set((await db.order.findMany({ select: { displayId: true } })).map((o) => o.displayId));
  let created = 0;
  for (const spec of specs) {
    if (existing.has(spec.displayId)) continue;
    const { weightG, volumeL } = quantitiesOf(spec);
    await db.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          displayId: spec.displayId,
          brand: spec.brand,
          tempRequirement: spec.temp,
          requestedDate: dateOnly(spec.requestedDate),
          currentDate: dateOnly(spec.deliveryDate),
          status: statusOf(spec),
          weightG,
          volumeL,
          placedAt: new Date(spec.placedAt),
          confirmedAt: new Date(spec.placedAt),
          deferredCount: spec.deferrals.length,
          idempotencyKey: `seed:${spec.displayId}`,
          outletId: lookup(ids.outlets, spec.outletId),
        },
      });
      const lineIds: string[] = [];
      for (const line of spec.lines) {
        const product = productBySku(line.sku);
        const row = await tx.orderLine.create({
          data: {
            orderId: order.id,
            productId: lookup(productIds, line.sku),
            qtyOrdered: line.qty,
            unitWeightKg: product.unitWeightKg,
            unitVolumeM3: product.unitVolumeM3,
          },
        });
        lineIds.push(row.id);
      }
      // uuidv7() is monotonic, so the IDs keep the timeline in insertion order (ADR 0010).
      const events: Prisma.OrderEventCreateManyInput[] = eventsOf(spec, lineIds).map((e) => ({
        id: uuidv7(),
        type: e.type,
        source: "SERVER",
        actorRole: e.actor.role,
        actorUserId: lookup(userIds, e.actor.loginId),
        capturedAt: new Date(e.at),
        receivedAt: new Date(e.at),
        payload: e.payload as Prisma.InputJsonValue,
        orderId: order.id,
      }));
      await tx.orderEvent.createMany({ data: events });
    });
    created++;
  }
  return { created, updated: 0 };
}
