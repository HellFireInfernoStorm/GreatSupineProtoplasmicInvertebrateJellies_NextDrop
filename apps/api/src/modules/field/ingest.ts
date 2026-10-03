import {
  parseClientEvent,
  type ClientEvent,
  type ErrorCode,
  type FieldEventType,
  type SyncEventResult,
} from "@nextdrop/contracts";
import { applyEvent, ordersGoingOut, reduceOrder, shortLinesBlockingReady, type OrderEvent } from "@nextdrop/rules";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { linkArrivedBlobs } from "../blobs";
import { appendFeed, readFeedHint, type FeedRowInput } from "../feed";
import type { NotificationInput, Notifier } from "../notifications";
import { appendServerEvent, orderChanged, orderInclude, toRulesEvent, type OrderRecord } from "../orders";
import type { Actor } from "../policy";

type FieldActor = Extract<Actor, { role: "LOADER" | "DRIVER" }>;

export interface IngestDependencies {
  prisma: PrismaClient;
  now: () => Date;
  notifier: Notifier;
}

/** Event authors (spec/events/catalogue.md "Source / author"). Declared actor metadata never authorizes on its own. */
const AUTHORED_BY: Readonly<Record<FieldActor["role"], ReadonlySet<FieldEventType>>> = {
  LOADER: new Set(["PLAN_ACKNOWLEDGED", "LOAD_SHORT", "LOAD_DAMAGED", "LOAD_CONFIRMED", "LOAD_REVERSED", "TRIP_READY"]),
  DRIVER: new Set([
    "PLAN_ACKNOWLEDGED",
    "TRIP_DEPARTED",
    "STOP_ARRIVED",
    "STOP_OUTCOME",
    "POD_CAPTURED",
    "PROBLEM_FLAGGED",
  ]),
};
/** Loader events about an order that must be on a trip (a reversal is the exception: it may follow a re-plan). */
const NEEDS_ASSIGNMENT: ReadonlySet<FieldEventType> = new Set([
  "LOAD_SHORT",
  "LOAD_DAMAGED",
  "LOAD_CONFIRMED",
  "STOP_ARRIVED",
  "STOP_OUTCOME",
  "POD_CAPTURED",
]);
const TX = { maxWait: 5_000, timeout: 10_000 } as const;
const MAX_ATTEMPTS = 3;

/** A domain refusal for one event; the batch carries on. */
class Refusal extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}
/** Another writer changed the order or trip between read and write: retry the event. */
class LostRace extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

interface Subjects {
  order: OrderRecord | null;
  trip: { id: string; status: string; vehicleId: string; depot: string } | null;
  vehicleId: string | null;
}

/** `POST /sync/events` (spec/sync/push-protocol.md): each event in its own short transaction, in deviceSeq order. */
export function createIngest(deps: IngestDependencies) {
  const { prisma, notifier } = deps;

  async function resolveSubjects(actor: FieldActor, event: ClientEvent): Promise<Subjects> {
    const { orderId, vehicleId } = event.subject;
    const tripId = event.subject.tripId ?? ("tripId" in event.payload ? (event.payload.tripId as string) : undefined);
    let order: OrderRecord | null = null;
    if (orderId) {
      order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
      if (!order) throw new Refusal("NOT_FOUND");
      const assigned = order.tripStop_orderId[0]?.trip.vehicleId ?? null;
      if (actor.role === "LOADER" && order.outlet.depot !== actor.depot) throw new Refusal("FORBIDDEN");
      if (actor.role === "DRIVER" && assigned !== actor.vehicleId) throw new Refusal("NOT_ASSIGNED");
      if (NEEDS_ASSIGNMENT.has(event.type) && assigned === null) throw new Refusal("NOT_ASSIGNED");
    }
    let trip: Subjects["trip"] = null;
    if (tripId) {
      const row = await prisma.trip.findUnique({
        where: { id: tripId },
        select: { id: true, status: true, vehicleId: true, planningDay: { select: { depot: true } } },
      });
      if (!row) throw new Refusal("NOT_FOUND");
      trip = { id: row.id, status: row.status, vehicleId: row.vehicleId, depot: row.planningDay.depot };
      if (actor.role === "LOADER" && trip.depot !== actor.depot) throw new Refusal("FORBIDDEN");
      if (actor.role === "DRIVER" && trip.vehicleId !== actor.vehicleId) throw new Refusal("NOT_ASSIGNED");
    }
    if (vehicleId) {
      const row = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { depot: true } });
      if (!row) throw new Refusal("NOT_FOUND");
      if (actor.role === "LOADER" && row.depot !== actor.depot) throw new Refusal("FORBIDDEN");
      if (actor.role === "DRIVER" && vehicleId !== actor.vehicleId) throw new Refusal("NOT_ASSIGNED");
    }
    return { order, trip, vehicleId: vehicleId ?? null };
  }

  /** Every line id in the payload belongs to the order. */
  function checkLines(order: OrderRecord, event: ClientEvent) {
    const lines = "lines" in event.payload ? (event.payload.lines as { lineId?: unknown }[] | undefined) : undefined;
    if (!lines) return;
    const known = new Set(order.orderLine_orderId.map((l) => l.id));
    if (lines.some((l) => typeof l.lineId !== "string" || !known.has(l.lineId))) throw new Refusal("SCHEMA_INVALID");
  }

  function storedEvent(actor: FieldActor, event: ClientEvent, receivedAt: Date, subjects: Subjects) {
    return {
      clientEventId: event.clientEventId,
      deviceId: event.deviceId,
      deviceSeq: event.deviceSeq,
      type: event.type,
      schemaVersion: event.schemaVersion,
      source: "FIELD" as const,
      actorRole: actor.role,
      actorUserId: actor.userId,
      capturedAt: new Date(event.capturedAt),
      clockOffsetMs: event.clockOffsetMs === undefined ? null : BigInt(event.clockOffsetMs),
      receivedAt,
      basedOnPlanVersion: event.basedOnPlanVersion ?? null,
      disposition: "APPLIED" as const,
      payload: event.payload as Prisma.InputJsonValue,
      orderId: subjects.order?.id ?? null,
      tripId: subjects.trip?.id ?? null,
      vehicleId: subjects.vehicleId,
    };
  }

  /** Insert idempotently: `createMany({ skipDuplicates })`, never by catching a unique violation in a transaction. */
  async function insertOnce(
    tx: Prisma.TransactionClient,
    data: ReturnType<typeof storedEvent>,
  ): Promise<string | null> {
    const { count } = await tx.orderEvent.createMany({ data: [data], skipDuplicates: true });
    if (count === 0) return null;
    return (
      await tx.orderEvent.findUniqueOrThrow({ where: { clientEventId: data.clientEventId }, select: { id: true } })
    ).id;
  }

  function notificationsFor(event: ClientEvent, subjects: Subjects): NotificationInput[] {
    const { order, trip } = subjects;
    const depot = order?.outlet.depot ?? trip?.depot;
    const entity = order ? { type: "order", id: order.id } : trip ? { type: "trip", id: trip.id } : null;
    if (!depot || !entity) return [];
    const params: Record<string, string> = order ? { order: order.displayId } : {};
    const dispatcher = (kind: NotificationInput["kind"]): NotificationInput => ({
      kind,
      audience: { role: "DISPATCHER", depot },
      params,
      entity,
    });
    switch (event.type) {
      case "LOAD_SHORT":
        return [
          dispatcher("short_reported"),
          ...(order
            ? [{ ...dispatcher("short_reported"), audience: { role: "STORE" as const, outletId: order.outletId } }]
            : []),
        ];
      case "LOAD_DAMAGED":
        return [dispatcher("damaged_reported")];
      case "STOP_OUTCOME": {
        const outcome = event.payload.outcome;
        if (outcome === "FULL" || outcome === "PARTIAL") {
          return order
            ? [{ kind: "delivered", audience: { role: "STORE", outletId: order.outletId }, params, entity }]
            : [];
        }
        return [dispatcher("stop_failed")];
      }
      case "PROBLEM_FLAGGED":
        return [{ ...dispatcher("problem_reported"), params: { ...params, problem: event.payload.kind } }];
      default:
        return [];
    }
  }

  function runUpdated(trip: NonNullable<Subjects["trip"]>): FeedRowInput {
    return {
      kind: "run_updated",
      entity: { type: "trip", id: trip.id },
      audience: { roles: ["DISPATCHER", "LOADER", "DRIVER"], depot: trip.depot, vehicleId: trip.vehicleId },
    };
  }

  /** An order fact: reduce, compare-and-set the status, record, project lines, notify, feed last. */
  async function ingestOrderEvent(actor: FieldActor, event: ClientEvent, subjects: Subjects, receivedAt: Date) {
    const order = subjects.order!;
    checkLines(order, event);
    const state = reduceOrder(order.id, order.orderEvent_orderId.map(toRulesEvent));
    const next = applyEvent(state, {
      id: "pending",
      type: event.type,
      subject: event.subject,
      payload: event.payload,
    } as OrderEvent);
    // Until conflict classification (#54) lands, every legal fact is applied; an illegal one is rejected.
    if (next.outcome.kind === "ILLEGAL_TRANSITION") throw new Refusal("ILLEGAL_TRANSITION");
    const status = next.state.status ?? order.status;
    const delivered =
      event.type === "STOP_OUTCOME" &&
      next.outcome.kind === "APPLIED" &&
      (event.payload.outcome === "FULL" || event.payload.outcome === "PARTIAL");
    const assignedVehicle = order.tripStop_orderId[0]?.trip.vehicleId ?? null;

    return prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: order.id, status: order.status },
        // "Confirmed after sync": the server's receipt time of the delivery fact (ADR 0031).
        data: { status, ...(delivered ? { confirmedAt: receivedAt } : {}) },
      });
      if (count === 0) throw new LostRace();
      const id = await insertOnce(tx, storedEvent(actor, event, receivedAt, subjects));
      if (id === null) return null;
      await linkArrivedBlobs(tx, id, event.payload);
      if (event.type === "LOAD_CONFIRMED") {
        for (const line of event.payload.lines) {
          await tx.orderLine.update({ where: { id: line.lineId }, data: { qtyLoaded: line.qtyLoaded } });
        }
      }
      if (event.type === "STOP_OUTCOME") {
        const reported = new Map((event.payload.lines ?? []).map((l) => [l.lineId, l.qtyDelivered]));
        for (const line of order.orderLine_orderId) {
          // A FULL delivery without line detail delivers what was loaded (or ordered, if loading was not recorded).
          const qty =
            reported.get(line.id) ??
            (event.payload.outcome === "FULL" ? (line.qtyLoaded > 0 ? line.qtyLoaded : line.qtyOrdered) : undefined);
          if (qty !== undefined) await tx.orderLine.update({ where: { id: line.id }, data: { qtyDelivered: qty } });
        }
      }
      const feed: FeedRowInput[] = [
        orderChanged({ id: order.id, outletId: order.outletId, depot: order.outlet.depot, vehicleId: assignedVehicle }),
      ];
      for (const input of notificationsFor(event, subjects)) feed.push(...(await notifier.notify(tx, input)));
      await appendFeed(tx, feed);
      return id;
    }, TX);
  }

  /** TRIP_READY and TRIP_DEPARTED move the trip; a departure takes its PLANNED and LOADED orders out (ADR 0019). */
  async function ingestTripEvent(actor: FieldActor, event: ClientEvent, subjects: Subjects, receivedAt: Date) {
    const trip = subjects.trip!;
    if (trip.status === "CANCELLED") throw new Refusal("ILLEGAL_TRANSITION");
    const stops = await prisma.tripStop.findMany({
      where: { tripId: trip.id },
      select: { order: { include: orderInclude } },
    });
    const states = stops.map(({ order }) => ({
      order,
      state: reduceOrder(order.id, order.orderEvent_orderId.map(toRulesEvent)),
    }));
    let nextStatus: "READY" | "DEPARTED" | null = null;
    let goingOut: string[] = [];
    if (event.type === "TRIP_READY") {
      if (states.some(({ state }) => shortLinesBlockingReady(state).length > 0))
        throw new Refusal("ILLEGAL_TRANSITION");
      if (trip.status === "PLANNED") nextStatus = "READY";
    } else if (trip.status === "PLANNED" || trip.status === "READY") {
      nextStatus = "DEPARTED";
      goingOut = ordersGoingOut(
        trip.id,
        states.map(({ state }) => state),
      );
    }
    // A repeated or late trip fact (already ready or departed) is recorded without moving the trip.

    return prisma.$transaction(async (tx) => {
      if (nextStatus) {
        // Trip stops follow through the (tripId, tripStatus) foreign key's ON UPDATE CASCADE.
        const { count } = await tx.trip.updateMany({
          where: { id: trip.id, status: trip.status as never },
          data: { status: nextStatus },
        });
        if (count === 0) throw new LostRace();
      }
      const id = await insertOnce(tx, storedEvent(actor, event, receivedAt, subjects));
      if (id === null) return null;
      await linkArrivedBlobs(tx, id, event.payload);
      const feed: FeedRowInput[] = [runUpdated(trip)];
      for (const { order } of states.filter(({ order }) => goingOut.includes(order.id))) {
        const { count } = await tx.order.updateMany({
          where: { id: order.id, status: order.status },
          data: { status: "OUT_FOR_DELIVERY" },
        });
        if (count === 0) throw new LostRace();
        await appendServerEvent(tx, {
          type: "ORDER_OUT_FOR_DELIVERY",
          payload: { tripId: trip.id },
          orderId: order.id,
          actor: { userId: actor.userId, role: actor.role },
          at: receivedAt,
        });
        feed.push(
          orderChanged({
            id: order.id,
            outletId: order.outletId,
            depot: order.outlet.depot,
            vehicleId: trip.vehicleId,
          }),
        );
      }
      await appendFeed(tx, feed);
      return id;
    }, TX);
  }

  /** Facts with no order to move (a trip acknowledgement, a vehicle problem): record, notify, feed last. */
  async function ingestRecordOnly(actor: FieldActor, event: ClientEvent, subjects: Subjects, receivedAt: Date) {
    return prisma.$transaction(async (tx) => {
      const id = await insertOnce(tx, storedEvent(actor, event, receivedAt, subjects));
      if (id === null) return null;
      await linkArrivedBlobs(tx, id, event.payload);
      const feed: FeedRowInput[] = subjects.trip ? [runUpdated(subjects.trip)] : [];
      for (const input of notificationsFor(event, subjects)) feed.push(...(await notifier.notify(tx, input)));
      await appendFeed(tx, feed);
      return id;
    }, TX);
  }

  async function ingestOne(
    actor: FieldActor,
    event: ClientEvent,
    index: number,
    receivedAt: Date,
    rejectedSubjects: Set<string>,
  ): Promise<SyncEventResult> {
    const at = receivedAt.toISOString();
    const subjectIds = [event.subject.orderId, event.subject.tripId, event.subject.vehicleId].filter(
      (id): id is string => id !== undefined,
    );
    const reject = (code: ErrorCode): SyncEventResult => {
      // Later events about the same order or trip depend on this one (push-protocol.md).
      for (const id of subjectIds) rejectedSubjects.add(id);
      return { status: "REJECTED", clientEventId: event.clientEventId, index, code, receivedAt: at };
    };

    if (event.actor.userId !== actor.userId || event.actor.role !== actor.role) return reject("FORBIDDEN");
    if (!AUTHORED_BY[actor.role].has(event.type)) return reject("FORBIDDEN");
    const existing = await prisma.orderEvent.findUnique({
      where: { clientEventId: event.clientEventId },
      select: { id: true, actorUserId: true },
    });
    if (existing) {
      if (existing.actorUserId !== actor.userId) return reject("FORBIDDEN");
      return { status: "DUPLICATE", clientEventId: event.clientEventId, serverEventId: existing.id, receivedAt: at };
    }
    if (subjectIds.some((id) => rejectedSubjects.has(id))) return reject("ILLEGAL_TRANSITION");
    const seqTaken = await prisma.orderEvent.count({
      where: { deviceId: event.deviceId, deviceSeq: event.deviceSeq },
    });
    if (seqTaken > 0) return reject("DUPLICATE");

    for (let attempt = 1; ; attempt++) {
      try {
        const subjects = await resolveSubjects(actor, event);
        const isTripFact = event.type === "TRIP_READY" || event.type === "TRIP_DEPARTED";
        const id = isTripFact
          ? await ingestTripEvent(actor, event, subjects, receivedAt)
          : subjects.order
            ? await ingestOrderEvent(actor, event, subjects, receivedAt)
            : await ingestRecordOnly(actor, event, subjects, receivedAt);
        if (id === null) {
          const winner = await prisma.orderEvent.findUniqueOrThrow({ where: { clientEventId: event.clientEventId } });
          return { status: "DUPLICATE", clientEventId: event.clientEventId, serverEventId: winner.id, receivedAt: at };
        }
        return { status: "ACCEPTED", clientEventId: event.clientEventId, serverEventId: id, receivedAt: at };
      } catch (error) {
        if (error instanceof Refusal) return reject(error.code);
        if ((error instanceof LostRace || isUniqueViolation(error)) && attempt < MAX_ATTEMPTS) continue;
        // Anything else fails the request (5xx): the client keeps the batch pending and retries it.
        throw error;
      }
    }
  }

  return {
    async ingest(actor: FieldActor, body: { deviceId: string; events: unknown[] }) {
      const receivedAt = deps.now();
      const at = receivedAt.toISOString();
      const results: SyncEventResult[] = new Array(body.events.length);
      const valid: { index: number; event: ClientEvent }[] = [];
      body.events.forEach((raw, index) => {
        const parsed = parseClientEvent(raw, body.deviceId, index, at);
        if (parsed.success) valid.push({ index, event: parsed.data });
        else results[index] = parsed.rejection;
      });
      // Process in deviceSeq order; the result keeps the original input position.
      valid.sort((a, b) => a.event.deviceSeq - b.event.deviceSeq || a.index - b.index);
      const rejectedSubjects = new Set<string>();
      for (const { index, event } of valid) {
        results[index] = await ingestOne(actor, event, index, receivedAt, rejectedSubjects);
      }
      if (valid.length > 0) {
        await prisma.device.update({
          where: { id: body.deviceId },
          data: { lastSeenAt: receivedAt, lastSyncAt: receivedAt },
        });
      }
      const hint = await readFeedHint(prisma);
      return { results, serverTime: at, feedHead: hint.head };
    },
  };
}

export type Ingest = ReturnType<typeof createIngest>;
