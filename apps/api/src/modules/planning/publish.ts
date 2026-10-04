// Publish transaction (spec/planning/publish-transaction.md §8.2, ADRs 0004, 0006, 0010): one atomic, idempotent
// transaction that writes an immutable plan version and everything that follows from it, or writes nothing.
import { parseEventPayload, type ApiDto } from "@nextdrop/contracts";
import {
  colomboInstant,
  computeFuel,
  computeRunSchedule,
  DEFAULT_RULES_CONFIG,
  deferralNoteRequired,
  effectiveWindow,
  etaBand,
  explainDeferral,
  isoWeekOf,
  validatePlan,
  lockedStopChange,
  type AllocationOrder,
  type LocalDate,
  type PlanTrip,
  type TripSchedule,
  type ValidationResult,
} from "@nextdrop/rules";
import type { PlanChange, PlanVersion, Prisma, PrismaClient } from "../../generated/prisma/client";
import { Prisma as PrismaNamespace } from "../../generated/prisma/client";
import type { Clock } from "../../lib/clock";
import { ApiHttpError } from "../../lib/errors";
import { appendFeed, type FeedRowInput } from "../feed";
import type { Notifier } from "../notifications";
import { appendServerEvent, dateOnly, orderInclude, outletInclude, toTripDto, type TripRecord } from "../orders";
import { loadDayInputs, toRulesPlan, type DayInputs } from "./inputs";
import type { ReferenceSource } from "./reference";

type PlanVersionDto = ApiDto<"planVersion">;
type DeferralDto = ApiDto<"deferral">;
type DraftData = ApiDto<"draftData">;
type Tx = Prisma.TransactionClient;

export interface PublishDependencies {
  prisma: PrismaClient;
  clock: Clock;
  reference: ReferenceSource;
  notifier: Notifier;
}

export interface PublishInput {
  depot: string;
  date: LocalDate;
  revision: number;
  actorUserId: string;
}

/** Day states a draft can be published from. */
const PUBLISHABLE = new Set(["PLANNING", "PUBLISHED", "IN_PROGRESS"]);

const revisionConflict = (current: number) =>
  new ApiHttpError(409, "REVISION_CONFLICT", "errors.revisionConflict", { revision: current });
const validationFailed = (validation: ValidationResult) =>
  new ApiHttpError(422, "VALIDATION_FAILED", "errors.validationFailed", {}, {}, { validation });

/** A trip as the dispatcher sees it: every stop. */
const dispatchTripInclude = {
  district: { select: { name: true } },
  planningDay: { select: { date: true } },
  stops: {
    orderBy: { seq: "asc" },
    include: { order: { include: { ...orderInclude, outlet: { include: outletInclude } } } },
  },
} satisfies Prisma.TripInclude;

/** Where an order sits in a published plan. `seq` is 1-based, as stored (the rules core counts from 0). */
interface Slot {
  tripId: string;
  vehicleId: string;
  tripNo: number;
  seq: number;
  etaMin: number;
}

/** Publish the day's draft at `revision`. Retries once when another depot took the same new trip display ID. */
export async function publishDay(deps: PublishDependencies, input: PublishInput): Promise<PlanVersion> {
  try {
    return await publishOnce(deps, input);
  } catch (error) {
    if (error instanceof PrismaNamespace.PrismaClientKnownRequestError && error.code === "P2002") {
      return publishOnce(deps, input);
    }
    throw error;
  }
}

async function publishOnce(deps: PublishDependencies, input: PublishInput): Promise<PlanVersion> {
  const { prisma } = deps;
  const reference = await deps.reference.get();
  const week = isoWeekOf(input.date);
  return prisma.$transaction(
    async (tx) => {
      // 1. Serialise publishes that share the depot's weekly fuel quota (ADR 0006).
      const lockKey = `publish:${input.depot}:${week.isoYear}-${week.isoWeek}`;
      await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${lockKey}))) AS locked`;

      // 2. Revision, idempotency and day state.
      const day = await tx.planningDay.findUnique({
        where: { depot_date: { depot: input.depot, date: dateOnly(input.date) } },
        include: { planDraft_planningDayId: true },
      });
      const draft = day?.planDraft_planningDayId;
      if (!day || !draft) throw revisionConflict(0);
      const done = await tx.planVersion.findUnique({
        where: { planningDayId_draftRevision: { planningDayId: day.id, draftRevision: input.revision } },
      });
      if (done) return done;
      if (draft.revision !== input.revision) throw revisionConflict(draft.revision);
      if (!PUBLISHABLE.has(day.state)) {
        throw new ApiHttpError(409, "ILLEGAL_TRANSITION", "errors.dayNotPublishable", { state: day.state });
      }

      // 3-4. Canonical inputs, then the authoritative check.
      const data = draft.data as DraftData;
      const inputs = await loadDayInputs(tx, reference, input.depot, input.date);
      const plan = toRulesPlan(data, inputs);
      const illegalStop = lockedStopChange(
        inputs.validation.publishedStops ?? [],
        data.trips.flatMap((t) =>
          t.orderIds.map((orderId, seq) => ({
            orderId,
            vehicleId: reference.ids.vehicleDisplay.get(t.vehicleId) ?? t.vehicleId,
            tripNo: t.tripNo,
            seq: seq + 1,
          })),
        ),
      );
      if (illegalStop) throw new ApiHttpError(409, "STOP_LOCKED", "errors.stopLocked", { orderId: illegalStop });
      const validation = validatePlan(plan, reference.ref, inputs.validation);
      if (!validation.ok) throw validationFailed(validation);

      // 5. A reason for every unassigned confirmed order; a note for OTHER and for a repeat deferral.
      const planned = new Set(plan.trips.flatMap((t) => t.orders.map((o) => o.id)));
      const reasons = new Map(data.deferrals.map((d) => [d.orderId, d]));
      const repeat = new Set(
        validation.violations.filter((v) => v.code === "REPEAT_DEFERRAL").flatMap((v) => v.orderIds),
      );
      const unassigned = inputs.allocation.orders.filter((o) => !planned.has(o.id));
      const missing = unassigned.filter((o) => {
        const d = reasons.get(o.id);
        const needsNote = deferralNoteRequired({ reasonCode: d?.reasonCode, deferredLastRun: repeat.has(o.id) });
        return !d?.reasonCode || (needsNote && !d.note?.trim());
      });
      if (missing.length > 0) {
        throw new ApiHttpError(
          422,
          "MISSING_DEFERRAL_REASON",
          "errors.missingDeferralReason",
          { orders: missing.length },
          {},
          { validation: { ...validation, ok: false } },
        );
      }

      // 6. Diff against the published plan; server facts, loaded pins and complete trips lock stops (ADR 0053).
      const current = await tx.trip.findMany({
        where: { planningDayId: day.id, status: { not: "CANCELLED" } },
        include: { stops: true },
      });
      const was = new Map<string, Slot>();
      for (const t of current) {
        for (const s of t.stops) {
          was.set(s.orderId, { tripId: t.id, vehicleId: t.vehicleId, tripNo: t.tripNo, seq: s.seq, etaMin: s.etaMin });
        }
      }
      const { vehicleUuid } = reference.ids;
      const schedules = scheduleByVehicle(plan.trips, inputs);
      const next = new Map<string, Omit<Slot, "tripId">>();
      for (const s of schedules) {
        for (const stop of s.stops) {
          next.set(stop.orderId, {
            vehicleId: vehicleUuid.get(s.trip.vehicleId)!,
            tripNo: s.trip.tripNo,
            seq: stop.seq + 1,
            etaMin: stop.display.start,
          });
        }
      }
      // 7. Trips and stops, written in place.
      const now = deps.clock.now();
      const version = day.currentVersion + 1;
      const tripIds = await writeTrips(tx, day.id, current, schedules, inputs);

      // Orders, events and deferrals.
      const queue = new Map(inputs.queue.map((o) => [o.id, o]));
      const changes: { orderId: string; tripId: string | null; change: PlanChange }[] = [];
      const feed: FeedRowInput[] = [];
      const deferralDtos: DeferralDto[] = [];
      const actor = { userId: input.actorUserId, role: "DISPATCHER" as const };
      const etaIso = (minute: number) => {
        const band = etaBand(minute);
        return {
          etaFrom: new Date(colomboInstant(input.date, band.open)).toISOString(),
          etaTo: new Date(colomboInstant(input.date, band.close)).toISOString(),
        };
      };

      for (const [orderId, slot] of next) {
        const order = queue.get(orderId)!;
        const tripId = tripIds.get(`${slot.vehicleId}:${slot.tripNo}`)!;
        const before = was.get(orderId);
        const to = { tripId, vehicleId: slot.vehicleId, seq: slot.seq, ...etaIso(slot.etaMin) };
        const change = changeOf(before, { ...slot, tripId });
        if (!change) continue;
        changes.push({ orderId, tripId, change });
        if (order.status !== "LOADED") {
          await appendServerEvent(tx, {
            type: "ORDER_PLANNED",
            payload: parseEventPayload("ORDER_PLANNED", { ...to, planVersion: version }),
            orderId,
            actor,
            at: now,
          });
          if (
            order.status !== "PLANNED" &&
            order.status !== "OUT_FOR_DELIVERY" &&
            ["ORDERED", "DEFERRED", "FAILED"].includes(order.status)
          )
            await tx.order.update({ where: { id: orderId }, data: { status: "PLANNED" } });
        }
        if (before) {
          const from = {
            tripId: before.tripId,
            vehicleId: before.vehicleId,
            seq: before.seq,
            ...etaIso(before.etaMin),
          };
          await appendServerEvent(tx, {
            type: "PLAN_CHANGED",
            payload: parseEventPayload("PLAN_CHANGED", { from, to, planVersion: version }),
            orderId,
            actor,
            at: now,
          });
        }
        feed.push(
          ...(await notifyStore(
            deps.notifier,
            tx,
            order.outletId,
            "eta_updated",
            orderId,
            order.displayId,
            to.etaFrom,
          )),
        );
        feed.push(orderChanged(order.outletId, input.depot, orderId, slot.vehicleId));
      }

      const finalPlan = { date: input.date, trips: plan.trips };
      const rankCtx = {
        unavailableVehicleIds: inputs.allocation.unavailableVehicleIds,
        breakdownVehicleIds: inputs.allocation.breakdownVehicleIds,
        fuelUsedThisWeekMl: inputs.allocation.fuelUsedThisWeekMl,
      };
      for (const order of unassigned) {
        const row = queue.get(order.id)!;
        const chosen = reasons.get(order.id)!;
        const why = explainDeferral(order as AllocationOrder, finalPlan, reference.ref, DEFAULT_RULES_CONFIG, rankCtx);
        const dto: DeferralDto = {
          orderId: order.id,
          reasonCode: chosen.reasonCode!,
          causeKind: why.causeKind,
          bindingConstraint: why.bindingConstraint,
          scoreInputs: why.scoreInputs,
          displacedBy: [...why.displacedBy],
          note: chosen.note ?? "",
          nextServiceableDate: why.nextServiceableDate,
          daysUnserved: why.daysUnserved,
          consecutiveDeferrals: why.consecutiveDeferrals,
        };
        deferralDtos.push(dto);
        await tx.deferral.create({
          data: {
            orderId: order.id,
            planningDayId: day.id,
            planVersion: version,
            reasonCode: dto.reasonCode,
            causeKind: dto.causeKind,
            bindingConstraint: dto.bindingConstraint,
            scoreInputs: (dto.scoreInputs ?? {}) as Prisma.InputJsonValue,
            decidedBy: "DISPATCHER",
            note: dto.note || null,
            nextServiceableDate: dateOnly(dto.nextServiceableDate),
            daysUnserved: dto.daysUnserved,
            consecutiveDeferrals: dto.consecutiveDeferrals,
          },
        });
        await appendServerEvent(tx, {
          type: "ORDER_DEFERRED",
          payload: parseEventPayload("ORDER_DEFERRED", {
            reasonCode: dto.reasonCode,
            causeKind: dto.causeKind,
            scoreInputs: dto.scoreInputs,
            toDate: dto.nextServiceableDate,
            daysUnserved: dto.daysUnserved,
            consecutiveDeferrals: dto.consecutiveDeferrals,
            note: dto.note,
            decidedBy: "DISPATCHER",
            planVersion: version,
          }),
          orderId: order.id,
          actor,
          at: now,
        });
        // Next-day rollover: the order re-enters the next operating day's queue.
        await tx.order.update({
          where: { id: order.id },
          data: { status: "DEFERRED", currentDate: dateOnly(dto.nextServiceableDate), deferredCount: { increment: 1 } },
        });
        changes.push({ orderId: order.id, tripId: was.get(order.id)?.tripId ?? null, change: "DEFERRED" });
        feed.push(
          ...(await notifyStore(
            deps.notifier,
            tx,
            row.outletId,
            "deferral_notice",
            order.id,
            row.displayId,
            dto.nextServiceableDate,
          )),
        );
        feed.push(orderChanged(row.outletId, input.depot, order.id, null));
      }

      // Outlet service state: deferred outlets were deferred on this run; served outlets were not.
      const deferredOutlets = new Set(unassigned.map((o) => queue.get(o.id)!.outletId));
      for (const outletId of new Set(inputs.queue.map((o) => o.outletId))) {
        await tx.outletServiceState.upsert({
          where: { outletId },
          create: { outletId, deferredLastRun: deferredOutlets.has(outletId) },
          update: { deferredLastRun: deferredOutlets.has(outletId) },
        });
      }

      // The immutable version: a snapshot of the trips as published, and the deferral explanations.
      const trips = (
        await tx.trip.findMany({
          where: { planningDayId: day.id, status: { not: "CANCELLED" } },
          include: dispatchTripInclude,
          orderBy: [{ vehicleId: "asc" }, { tripNo: "asc" }],
        })
      ).map((t) => toTripDto(t as unknown as TripRecord));
      const summary = { served: next.size, deferred: unassigned.length, trips: trips.length };
      const snapshot = { trips, deferrals: deferralDtos } satisfies Pick<PlanVersionDto, "trips" | "deferrals">;
      const saved = await tx.planVersion.create({
        data: {
          planningDayId: day.id,
          version,
          draftRevision: input.revision,
          publishedAt: now,
          publishedBy: input.actorUserId,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          summary,
        },
      });
      if (changes.length) {
        await tx.planVersionChange.createMany({
          data: changes.map((c) => ({
            planVersionId: saved.id,
            orderId: c.orderId,
            tripId: c.tripId,
            change: c.change,
          })),
        });
      }
      await tx.planningDay.update({
        where: { id: day.id },
        data: { currentVersion: version, ...(day.state === "PLANNING" ? { state: "PUBLISHED" } : {}) },
      });
      await tx.planDraft.update({ where: { id: draft.id }, data: { baseVersion: version } });

      // Loaders of the depot and drivers of every vehicle on the plan, or whose trips were dropped.
      const vehicles = new Set([...next.values()].map((s) => s.vehicleId));
      for (const t of current) vehicles.add(t.vehicleId);
      const entity = { type: "planVersion", id: saved.id };
      const params = { date: input.date, depot: input.depot, version };
      feed.push(
        ...(await deps.notifier.notify(tx, {
          kind: "plan_changed",
          audience: { role: "LOADER", depot: input.depot },
          params,
          entity,
        })),
      );
      for (const vehicleId of vehicles) {
        feed.push(
          ...(await deps.notifier.notify(tx, {
            kind: "plan_changed",
            audience: { role: "DRIVER", vehicleId },
            params,
            entity,
          })),
        );
        feed.push({ kind: "plan_published", entity, version, audience: { roles: ["DRIVER"], vehicleId } });
      }
      feed.push({
        kind: "plan_published",
        entity,
        version,
        audience: { roles: ["DISPATCHER", "LOADER"], depot: input.depot },
      });

      // 8. Feed rows last. 9. The SSE hub polls the head, so the new head goes out after commit.
      await appendFeed(tx, feed);
      return saved;
    },
    { timeout: 60_000, maxWait: 30_000 },
  );
}

function changeOf(before: Slot | undefined, after: Slot): PlanChange | null {
  if (!before) return "ADDED";
  if (before.vehicleId !== after.vehicleId) return "MOVED_VEHICLE";
  if (before.tripNo !== after.tripNo) return "MOVED_TRIP";
  if (before.seq !== after.seq) return "RESEQUENCED";
  if (before.etaMin !== after.etaMin) return "ETA_CHANGED";
  return null;
}

function orderChanged(outletId: string, depot: string, orderId: string, vehicleId: string | null): FeedRowInput {
  return {
    kind: "order_changed",
    entity: { type: "order", id: orderId },
    audience: {
      roles: vehicleId ? ["STORE", "DISPATCHER", "LOADER", "DRIVER"] : ["STORE", "DISPATCHER", "LOADER"],
      outletId,
      depot,
      vehicleId,
    },
  };
}

function notifyStore(
  notifier: Notifier,
  tx: Tx,
  outletId: string,
  kind: "eta_updated" | "deferral_notice",
  orderId: string,
  displayId: string,
  when: string,
) {
  return notifier.notify(tx, {
    kind,
    audience: { role: "STORE", outletId },
    params: kind === "eta_updated" ? { order: displayId, etaFrom: when } : { order: displayId, toDate: when },
    entity: { type: "order", id: orderId },
  });
}

/** Display-time schedules for every vehicle's trips, as the rules core computes them. */
function scheduleByVehicle(trips: readonly PlanTrip[], inputs: DayInputs): TripSchedule[] {
  const byVehicle = new Map<string, PlanTrip[]>();
  for (const t of trips) byVehicle.set(t.vehicleId, [...(byVehicle.get(t.vehicleId) ?? []), t]);
  return [...byVehicle.values()].flatMap((run) => computeRunSchedule(run, inputs.reference.ref));
}

/**
 * Upsert the day's trips by (vehicle, trip number) and rewrite their stops in place: stops that left a trip are removed
 * first (freeing the one-active-stop-per-order index), kept stops are re-sequenced, new ones created. Trips no longer
 * in the plan are cancelled. Returns trip IDs keyed by `vehicleUuid:tripNo`.
 */
async function writeTrips(
  tx: Tx,
  planningDayId: string,
  current: Prisma.TripGetPayload<{ include: { stops: true } }>[],
  schedules: TripSchedule[],
  inputs: DayInputs,
): Promise<Map<string, string>> {
  const { ref, ids } = inputs.reference;
  const districts = new Map(
    (await tx.district.findMany({ select: { id: true, name: true } })).map((d) => [d.name, d.id]),
  );
  const key = (vehicleId: string, tripNo: number) => `${vehicleId}:${tripNo}`;
  const wanted = new Map(schedules.map((s) => [key(ids.vehicleUuid.get(s.trip.vehicleId)!, s.trip.tripNo), s]));
  const existing = await tx.trip.findMany({ where: { planningDayId } });
  const byKey = new Map(existing.map((t) => [key(t.vehicleId, t.tripNo), t]));

  // Remove stops that are leaving their trip, everywhere first.
  for (const t of current) {
    const s = wanted.get(key(t.vehicleId, t.tripNo));
    const keep = new Set(s ? s.stops.map((x) => x.orderId) : []);
    const leaving = t.stops.filter((x) => !keep.has(x.orderId)).map((x) => x.id);
    if (leaving.length) await tx.tripStop.deleteMany({ where: { id: { in: leaving } } });
  }
  for (const t of current) {
    if (!wanted.has(key(t.vehicleId, t.tripNo)))
      await tx.trip.update({ where: { id: t.id }, data: { status: "CANCELLED" } });
  }

  let nextNumber = await nextTripNumber(tx);
  const tripIds = new Map<string, string>();
  for (const [k, s] of wanted) {
    const vehicle = ref.vehicles.get(s.trip.vehicleId)!;
    const fuel = computeFuel(s.trip, vehicle, ref);
    const fields = {
      brand: s.time.brand!,
      districtId: districts.get(s.time.district!)!,
      plannedDepart: s.departure.display,
      plannedMinutes: s.time.totalMin,
      km: fuel.km.toFixed(3),
      litres: fuel.litres.toFixed(3),
    };
    const row = byKey.get(k);
    let tripId: string;
    let status: Prisma.TripGetPayload<object>["status"];
    if (row) {
      status = row.status === "CANCELLED" ? "PLANNED" : row.status;
      await tx.trip.update({ where: { id: row.id }, data: { ...fields, status } });
      tripId = row.id;
    } else {
      status = "PLANNED";
      const created = await tx.trip.create({
        data: {
          ...fields,
          displayId: `T${String(nextNumber++).padStart(3, "0")}`,
          tripNo: s.trip.tripNo,
          planningDayId,
          vehicleId: ids.vehicleUuid.get(s.trip.vehicleId)!,
        },
      });
      tripId = created.id;
    }
    tripIds.set(k, tripId);

    const stops = await tx.tripStop.findMany({ where: { tripId } });
    const have = new Map(stops.map((x) => [x.orderId, x]));
    // Two passes, so re-sequencing never collides on (trip, seq).
    for (const x of stops) await tx.tripStop.update({ where: { id: x.id }, data: { seq: x.seq + 10_000 } });
    for (const stop of s.stops) {
      const outlet = ref.outlets.get(inputs.allocation.orders.find((o) => o.id === stop.orderId)!.outletId)!;
      const window = effectiveWindow(outlet) ?? outlet.window;
      const data = {
        seq: stop.seq + 1,
        etaMin: stop.display.start,
        windowOpen: window.open,
        windowClose: window.close,
        serviceMin: s.time.handlingByOrder[stop.orderId] ?? 0,
      };
      const current = have.get(stop.orderId);
      if (current) await tx.tripStop.update({ where: { id: current.id }, data });
      else await tx.tripStop.create({ data: { ...data, tripId, tripStatus: status, orderId: stop.orderId } });
    }
  }
  return tripIds;
}

/** The next free global `Tnnn` trip number. */
async function nextTripNumber(tx: Tx): Promise<number> {
  const rows = await tx.trip.findMany({ select: { displayId: true } });
  let max = 0;
  for (const r of rows) {
    const m = /^T(\d+)$/.exec(r.displayId);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}
