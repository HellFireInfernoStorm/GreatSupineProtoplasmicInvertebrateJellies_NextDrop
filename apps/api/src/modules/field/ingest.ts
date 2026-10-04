import {
  parseClientEvent,
  type ClientEvent,
  type ConflictKind,
  type ErrorCode,
  type FieldEventType,
  type SyncEventResult,
} from "@nextdrop/contracts";
import {
  applyEvent,
  colomboLocal,
  ordersGoingOut,
  reduceOrder,
  tripChecklistReadiness,
  type OrderEvent,
} from "@nextdrop/rules";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { linkArrivedBlobs } from "../blobs";
import { appendFeed, readFeedHint, type FeedRowInput } from "../feed";
import type { NotificationInput, Notifier } from "../notifications";
import {
  appendServerEvent,
  dateOnly,
  inEffect,
  orderChanged,
  orderInclude,
  toRulesEvent,
  type OrderRecord,
} from "../orders";
import type { Actor } from "../policy";
import { classifyFact, HOLDABLE_FACTS, type PlanContext, type Slot } from "./classify";
import { isDelivering, projectFact } from "./effects";

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
  trip: { id: string; status: string; vehicleId: string; depot: string; planningDayId: string } | null;
  vehicleId: string | null;
  /** The plan the device saw and what changed since (holdable order facts only). */
  plan: PlanContext | null;
}

/** What one ingested event became. */
type Stored = { id: string; conflictId: string | null } | null;

/** The trip and vehicle a published snapshot (`PlanVersion.snapshot.trips`, TripDto[]) puts the order on. */
function slotIn(snapshot: unknown, orderId: string): Slot | null {
  const trips = (snapshot as { trips?: unknown } | null)?.trips;
  if (!Array.isArray(trips)) return null;
  for (const trip of trips as { id?: unknown; vehicleId?: unknown; stops?: { order?: { id?: unknown } }[] }[]) {
    if (typeof trip.id !== "string" || typeof trip.vehicleId !== "string") continue;
    if (trip.stops?.some((stop) => stop.order?.id === orderId)) return { tripId: trip.id, vehicleId: trip.vehicleId };
  }
  return null;
}

/** `POST /sync/events` (spec/sync/push-protocol.md): each event in its own short transaction, in deviceSeq order. */
export function createIngest(deps: IngestDependencies) {
  const { prisma, notifier } = deps;

  /**
   * The plan version the device worked from (`basedOnPlanVersion = v`) and the changes to this order since, on the
   * fact's planning day: the subject trip's day, else the order's depot on the Colombo capture date (ADR 0040).
   */
  async function planContext(
    order: OrderRecord,
    event: ClientEvent,
    trip: Subjects["trip"],
  ): Promise<PlanContext | null> {
    const v = event.basedOnPlanVersion;
    if (v === undefined) return null;
    const day = trip
      ? await prisma.planningDay.findUnique({ where: { id: trip.planningDayId } })
      : await prisma.planningDay.findUnique({
          where: {
            depot_date: {
              depot: order.outlet.depot,
              date: dateOnly(colomboLocal(Date.parse(event.capturedAt)).date),
            },
          },
        });
    if (!day || day.currentVersion <= v) return null;
    const [atV, changes] = await Promise.all([
      prisma.planVersion.findUnique({
        where: { planningDayId_version: { planningDayId: day.id, version: v } },
        select: { snapshot: true },
      }),
      prisma.planVersionChange.findMany({
        where: {
          orderId: order.id,
          planVersion: { planningDayId: day.id, version: { gt: v, lte: day.currentVersion } },
        },
        select: { change: true },
      }),
    ]);
    return { slotAtV: slotIn(atV?.snapshot, order.id), changes: changes.map((c) => c.change) };
  }

  async function resolveSubjects(actor: FieldActor, event: ClientEvent): Promise<Subjects> {
    const { orderId, vehicleId } = event.subject;
    const tripId = event.subject.tripId ?? ("tripId" in event.payload ? (event.payload.tripId as string) : undefined);
    let trip: Subjects["trip"] = null;
    if (tripId) {
      const row = await prisma.trip.findUnique({
        where: { id: tripId },
        select: {
          id: true,
          status: true,
          vehicleId: true,
          planningDayId: true,
          planningDay: { select: { depot: true } },
        },
      });
      if (!row) throw new Refusal("NOT_FOUND");
      trip = {
        id: row.id,
        status: row.status,
        vehicleId: row.vehicleId,
        depot: row.planningDay.depot,
        planningDayId: row.planningDayId,
      };
      if (actor.role === "LOADER" && trip.depot !== actor.depot) throw new Refusal("FORBIDDEN");
      if (actor.role === "DRIVER" && trip.vehicleId !== actor.vehicleId) throw new Refusal("NOT_ASSIGNED");
    }
    let order: OrderRecord | null = null;
    let plan: PlanContext | null = null;
    if (orderId) {
      order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
      if (!order) throw new Refusal("NOT_FOUND");
      const assigned = order.tripStop_orderId[0]?.trip.vehicleId ?? null;
      if (actor.role === "LOADER" && order.outlet.depot !== actor.depot) throw new Refusal("FORBIDDEN");
      if (HOLDABLE_FACTS.has(event.type)) plan = await planContext(order, event, trip);
      // A stop a newer plan moved or removed still belongs to the device that had it at version v (§9.5).
      const hadIt = plan?.slotAtV != null && (actor.role === "LOADER" || plan.slotAtV.vehicleId === actor.vehicleId);
      if (actor.role === "DRIVER" && assigned !== actor.vehicleId && !hadIt) throw new Refusal("NOT_ASSIGNED");
      if (NEEDS_ASSIGNMENT.has(event.type) && assigned === null && !hadIt) throw new Refusal("NOT_ASSIGNED");
    }
    if (vehicleId) {
      const row = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { depot: true } });
      if (!row) throw new Refusal("NOT_FOUND");
      if (actor.role === "LOADER" && row.depot !== actor.depot) throw new Refusal("FORBIDDEN");
      if (actor.role === "DRIVER" && vehicleId !== actor.vehicleId) throw new Refusal("NOT_ASSIGNED");
    }
    return { order, trip, vehicleId: vehicleId ?? null, plan };
  }

  /** Every line id in the payload belongs to the order. */
  function checkLines(order: OrderRecord, event: ClientEvent) {
    const lines = "lines" in event.payload ? (event.payload.lines as { lineId?: unknown }[] | undefined) : undefined;
    if (!lines) return;
    const known = new Set(order.orderLine_orderId.map((l) => l.id));
    if (lines.some((l) => typeof l.lineId !== "string" || !known.has(l.lineId))) throw new Refusal("SCHEMA_INVALID");
  }

  function storedEvent(
    actor: FieldActor,
    event: ClientEvent,
    receivedAt: Date,
    subjects: Subjects,
    disposition: "APPLIED" | "HELD" = "APPLIED",
  ) {
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
      disposition,
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

  function runUpdated(trip: { id: string; depot: string; vehicleId: string }): FeedRowInput {
    return {
      kind: "run_updated",
      entity: { type: "trip", id: trip.id },
      audience: { roles: ["DISPATCHER", "LOADER", "DRIVER"], depot: trip.depot, vehicleId: trip.vehicleId },
    };
  }

  /** An order fact: reduce, compare-and-set the status, record, project lines, notify, feed last. */
  async function ingestOrderEvent(
    actor: FieldActor,
    event: ClientEvent,
    subjects: Subjects,
    receivedAt: Date,
  ): Promise<Stored> {
    const order = subjects.order!;
    checkLines(order, event);
    const state = reduceOrder(order.id, order.orderEvent_orderId.map(toRulesEvent));
    const next = applyEvent(state, {
      id: "pending",
      type: event.type,
      subject: event.subject,
      payload: event.payload,
    } as OrderEvent);
    const stop = order.tripStop_orderId[0];
    const effective = inEffect(order.orderEvent_orderId);
    const verdict = classifyFact({
      type: event.type,
      plan: subjects.plan,
      current: stop ? { tripId: stop.tripId, vehicleId: stop.trip.vehicleId } : null,
      appliedSameTypeDevices: order.orderEvent_orderId
        .filter((e) => e.type === event.type && effective(e))
        .map((e) => e.deviceId),
      deviceId: event.deviceId,
      outcome: next.outcome,
    });
    if (verdict.kind === "REJECT") throw new Refusal("ILLEGAL_TRANSITION");
    if (verdict.kind === "HOLD") return ingestHeld(actor, event, subjects, receivedAt, verdict.conflict);

    const status = next.state.status ?? order.status;
    const delivered = next.outcome.kind === "APPLIED" && isDelivering(event.type, event.payload);
    const assignedVehicle = stop?.trip.vehicleId ?? null;

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
      await projectFact(tx, order, event.type, event.payload);
      const feed: FeedRowInput[] = [
        orderChanged({ id: order.id, outletId: order.outletId, depot: order.outlet.depot, vehicleId: assignedVehicle }),
      ];
      // The run monitor counts stops done from these facts (ADR 0041).
      if (stop) feed.push(runUpdated({ id: stop.tripId, depot: order.outlet.depot, vehicleId: stop.trip.vehicleId }));
      for (const input of notificationsFor(event, subjects)) feed.push(...(await notifier.notify(tx, input)));
      await appendFeed(tx, feed);
      return { id, conflictId: null };
    }, TX);
  }

  /**
   * A clash (§9.5): store the fact as HELD with its evidence, open a Conflict, emit CONFLICT_OPENED and tell the
   * dispatcher. The order does not move; the reducer skips the fact until the dispatcher decides.
   */
  async function ingestHeld(
    actor: FieldActor,
    event: ClientEvent,
    subjects: Subjects,
    receivedAt: Date,
    kind: ConflictKind,
  ): Promise<Stored> {
    const order = subjects.order!;
    const tripId = subjects.trip?.id ?? subjects.plan?.slotAtV?.tripId ?? order.tripStop_orderId[0]?.tripId ?? null;
    return prisma.$transaction(async (tx) => {
      // The CAS on status serialises this with any other writer of the order.
      const { count } = await tx.order.updateMany({
        where: { id: order.id, status: order.status },
        data: { status: order.status },
      });
      if (count === 0) throw new LostRace();
      const id = await insertOnce(tx, storedEvent(actor, event, receivedAt, subjects, "HELD"));
      if (id === null) return null;
      await linkArrivedBlobs(tx, id, event.payload);
      const conflict = await tx.conflict.create({
        data: { kind, orderId: order.id, tripId, heldEventId: id, openedBy: actor.userId, openedAt: receivedAt },
      });
      await appendServerEvent(tx, {
        type: "CONFLICT_OPENED",
        payload: { conflictId: conflict.id, kind, heldEventId: id },
        orderId: order.id,
        actor: { userId: actor.userId, role: actor.role },
        at: receivedAt,
      });
      const depot = order.outlet.depot;
      const feed: FeedRowInput[] = [
        {
          kind: "conflict_opened",
          entity: { type: "conflict", id: conflict.id },
          audience: {
            roles: ["DISPATCHER", actor.role],
            depot,
            ...(actor.role === "DRIVER" ? { vehicleId: actor.vehicleId } : {}),
          },
        },
        orderChanged({
          id: order.id,
          outletId: order.outletId,
          depot,
          vehicleId: order.tripStop_orderId[0]?.trip.vehicleId ?? null,
        }),
        ...(await notifier.notify(tx, {
          kind: "conflict_opened",
          audience: { role: "DISPATCHER", depot },
          params: { order: order.displayId, kind },
          entity: { type: "conflict", id: conflict.id },
        })),
      ];
      await appendFeed(tx, feed);
      return { id, conflictId: conflict.id };
    }, TX);
  }

  /** TRIP_READY and TRIP_DEPARTED move the trip; a departure takes its PLANNED and LOADED orders out (ADR 0019). */
  async function ingestTripEvent(
    actor: FieldActor,
    event: ClientEvent,
    subjects: Subjects,
    receivedAt: Date,
  ): Promise<Stored> {
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
      // Checklist completeness + dispatcher short blockers share one rules gate (ADR 0047).
      const readiness = tripChecklistReadiness(
        states.map(({ order, state }) => ({
          orderId: order.id,
          lines: order.orderLine_orderId.map((line) => ({
            lineId: line.id,
            qtyOrdered: line.qtyOrdered,
            qtyLoaded: line.qtyLoaded,
          })),
          state,
        })),
      );
      if (!readiness.ready) throw new Refusal("ILLEGAL_TRANSITION");
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
      return { id, conflictId: null };
    }, TX);
  }

  /** Facts with no order to move (a trip acknowledgement, a vehicle problem): record, notify, feed last. */
  async function ingestRecordOnly(
    actor: FieldActor,
    event: ClientEvent,
    subjects: Subjects,
    receivedAt: Date,
  ): Promise<Stored> {
    return prisma.$transaction(async (tx) => {
      const id = await insertOnce(tx, storedEvent(actor, event, receivedAt, subjects));
      if (id === null) return null;
      await linkArrivedBlobs(tx, id, event.payload);
      const feed: FeedRowInput[] = subjects.trip ? [runUpdated(subjects.trip)] : [];
      for (const input of notificationsFor(event, subjects)) feed.push(...(await notifier.notify(tx, input)));
      await appendFeed(tx, feed);
      return { id, conflictId: null };
    }, TX);
  }

  const findStored = (clientEventId: string) =>
    prisma.orderEvent.findUnique({
      where: { clientEventId },
      select: { id: true, actorUserId: true, conflict_heldEventId: { select: { id: true } } },
    });

  /** A retried event: a held one reports its conflict again so a device that lost the response still learns it. */
  function repeated(
    existing: NonNullable<Awaited<ReturnType<typeof findStored>>>,
    clientEventId: string,
    at: string,
  ): SyncEventResult {
    const conflictId = existing.conflict_heldEventId?.id;
    if (conflictId) {
      return { status: "HELD_CONFLICT", clientEventId, conflictId, serverEventId: existing.id, receivedAt: at };
    }
    return { status: "DUPLICATE", clientEventId, serverEventId: existing.id, receivedAt: at };
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
    const existing = await findStored(event.clientEventId);
    if (existing) {
      if (existing.actorUserId !== actor.userId) return reject("FORBIDDEN");
      return repeated(existing, event.clientEventId, at);
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
        const stored = isTripFact
          ? await ingestTripEvent(actor, event, subjects, receivedAt)
          : subjects.order
            ? await ingestOrderEvent(actor, event, subjects, receivedAt)
            : await ingestRecordOnly(actor, event, subjects, receivedAt);
        if (stored === null) return repeated((await findStored(event.clientEventId))!, event.clientEventId, at);
        if (stored.conflictId) {
          return {
            status: "HELD_CONFLICT",
            clientEventId: event.clientEventId,
            conflictId: stored.conflictId,
            serverEventId: stored.id,
            receivedAt: at,
          };
        }
        return { status: "ACCEPTED", clientEventId: event.clientEventId, serverEventId: stored.id, receivedAt: at };
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
