// Planning API (spec/planning/flow.md, spec/platform/api-dtos.md): day, propose, draft, validate and fleet.
import {
  dateParamsSchema,
  dateQuerySchema,
  dayQuerySchema,
  dayResponseSchema,
  draftResponseSchema,
  fleetResponseSchema,
  mutationHeadersSchema,
  proposeRequestSchema,
  proposeResponseSchema,
  publishRequestSchema,
  publishResponseSchema,
  saveDraftRequestSchema,
  validateRequestSchema,
  validationResultSchema,
  versionsResponseSchema,
  type ApiDto,
} from "@nextdrop/contracts";
import { cutoffAt, proposePlan, validatePlan, type LocalDate, type ValidationResult } from "@nextdrop/rules";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { PlanDraft, PlanningDay, PlanVersion, PrismaClient } from "../../generated/prisma/client";
import { Prisma } from "../../generated/prisma/client";
import type { Clock } from "../../lib/clock";
import { ApiHttpError, forbidden } from "../../lib/errors";
import { dateOnly, toOrderDto } from "../orders";
import type { Notifier } from "../notifications";
import { collectionResource, type Resource } from "../policy";
import { loadDayInputs, toDraftData, toRulesPlan, toPlanningContext, type DayInputs, QUEUE_STATUSES } from "./inputs";
import { publishDay } from "./publish";
import type { ReferenceSource } from "./reference";

export interface PlanningRouteDependencies {
  prisma: PrismaClient;
  clock: Clock;
  reference: ReferenceSource;
  notifier: Notifier;
}

type DraftData = ApiDto<"draftData">;
type DraftDto = ApiDto<"draft">;

/** Day states whose draft may be written: orders are closed. */
const DRAFT_STATES: ReadonlySet<PlanningDay["state"]> = new Set(["CLOSED", "PLANNING", "PUBLISHED", "IN_PROGRESS"]);

const depotResource = (request: FastifyRequest): Resource => ({
  kind: "depot",
  depot: (request.query as { depot: string }).depot,
});

const revisionConflict = (current: number) =>
  new ApiHttpError(409, "REVISION_CONFLICT", "errors.revisionConflict", { revision: current });

const validationFailed = (validation: ValidationResult) =>
  new ApiHttpError(422, "VALIDATION_FAILED", "errors.validationFailed", {}, {}, { validation });

function toDraftDto(draft: PlanDraft): DraftDto {
  return {
    revision: draft.revision,
    baseVersion: draft.baseVersion > 0 ? draft.baseVersion : null,
    data: draft.data as DraftData,
    updatedAt: draft.updatedAt.toISOString(),
  };
}

export const planningRoutes: FastifyPluginAsyncZod<PlanningRouteDependencies> = async (app, deps) => {
  const { prisma, clock } = deps;

  async function inputs(depot: string, date: LocalDate): Promise<DayInputs> {
    return loadDayInputs(prisma, await deps.reference.get(), depot, date);
  }

  /** The day row, or its state from the cutoff when the tick has not created it yet. */
  async function dayOf(depot: string, date: LocalDate) {
    const row = await prisma.planningDay.findUnique({ where: { depot_date: { depot, date: dateOnly(date) } } });
    const closed = clock.now().getTime() >= cutoffAt(date);
    return { row, state: row?.state ?? (closed ? ("CLOSED" as const) : ("OPEN" as const)) };
  }

  /** The day to write a draft for: its row, created from the cutoff if missing; refused while orders are open. */
  async function writableDay(depot: string, date: LocalDate): Promise<PlanningDay> {
    const { row, state } = await dayOf(depot, date);
    if (!DRAFT_STATES.has(state))
      throw new ApiHttpError(409, "ILLEGAL_TRANSITION", "errors.dayNotPlannable", { state });
    if (row) return row;
    await prisma.planningDay.createMany({
      data: [{ depot, date: dateOnly(date), state: "CLOSED", ordersClosedAt: new Date(cutoffAt(date)) }],
      skipDuplicates: true,
    });
    return prisma.planningDay.findUniqueOrThrow({ where: { depot_date: { depot, date: dateOnly(date) } } });
  }

  /**
   * Write the draft if `revision` is current (0 = no draft yet), as one transaction; the day moves CLOSED -> PLANNING.
   * A stale revision, or a concurrent first write, is 409 REVISION_CONFLICT.
   */
  async function writeDraft(day: PlanningDay, revision: number, data: DraftData, userId: string): Promise<PlanDraft> {
    try {
      return await prisma.$transaction(async (tx) => {
        const current = await tx.planDraft.findUnique({ where: { planningDayId: day.id } });
        if ((current?.revision ?? 0) !== revision) throw revisionConflict(current?.revision ?? 0);
        const fields = { data, baseVersion: day.currentVersion, updatedBy: userId };
        let draft: PlanDraft;
        if (current) {
          const { count } = await tx.planDraft.updateMany({
            where: { id: current.id, revision },
            data: { ...fields, revision: revision + 1 },
          });
          if (count === 0) throw revisionConflict(revision);
          draft = await tx.planDraft.findUniqueOrThrow({ where: { id: current.id } });
        } else {
          draft = await tx.planDraft.create({ data: { ...fields, planningDayId: day.id, revision: 1 } });
        }
        await tx.planningDay.updateMany({ where: { id: day.id, state: "CLOSED" }, data: { state: "PLANNING" } });
        return draft;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw revisionConflict(revision);
      throw error;
    }
  }

  const actorId = (request: FastifyRequest) => {
    if (!request.actor) throw forbidden();
    return request.actor.userId;
  };

  app.get(
    "/api/dispatch/days/:date",
    {
      schema: { params: dateParamsSchema, querystring: dayQuerySchema, response: { 200: dayResponseSchema } },
      config: { policy: { action: "dispatchDay", resourceResolver: depotResource } },
    },
    async (request) => {
      const { date } = request.params;
      const { depot } = request.query;
      const [{ row, state }, day] = await Promise.all([dayOf(depot, date), inputs(depot, date)]);
      return {
        date,
        depot,
        state,
        ordersClosedAt: row?.ordersClosedAt?.toISOString() ?? null,
        currentVersion: row && row.currentVersion > 0 ? row.currentVersion : null,
        queue: day.queue.map(toOrderDto),
        planningContext: toPlanningContext(day),
        // What the allocator could serve from this queue with the available fleet: demand against capacity.
        demandCapacity: proposePlan(
          {
            ...day.allocation,
            orders: day.allocation.orders.filter((o) => QUEUE_STATUSES.some((status) => status === o.status)),
          },
          day.reference.ref,
        ).stats,
        serverTime: clock.now().toISOString(),
      };
    },
  );

  app.post(
    "/api/dispatch/days/:date/propose",
    {
      schema: {
        params: dateParamsSchema,
        querystring: dayQuerySchema,
        headers: mutationHeadersSchema,
        body: proposeRequestSchema,
        response: { 200: proposeResponseSchema },
      },
      config: { policy: { action: "propose", resourceResolver: depotResource } },
    },
    async (request) => {
      const { date } = request.params;
      const { depot } = request.query;
      const planningDay = await writableDay(depot, date);
      const day = await inputs(depot, date);
      if (day.validation.publishedStops?.some((s) => s.departed))
        throw new ApiHttpError(409, "ILLEGAL_TRANSITION", "errors.dayNotPlannable", { state: planningDay.state });
      const result = proposePlan(day.allocation, day.reference.ref);
      const draft = await writeDraft(planningDay, request.body.revision, toDraftData(result, day), actorId(request));
      return { draft: toDraftDto(draft), stats: result.stats, trace: [...result.trace] };
    },
  );

  app.get(
    "/api/dispatch/days/:date/draft",
    {
      schema: { params: dateParamsSchema, querystring: dayQuerySchema, response: { 200: draftResponseSchema } },
      config: { policy: { action: "getDraft", resourceResolver: depotResource } },
    },
    async (request) => {
      const day = await prisma.planningDay.findUnique({
        where: { depot_date: { depot: request.query.depot, date: dateOnly(request.params.date) } },
        include: { planDraft_planningDayId: true },
      });
      const draft = day?.planDraft_planningDayId;
      return { draft: draft ? toDraftDto(draft) : null };
    },
  );

  app.put(
    "/api/dispatch/days/:date/draft",
    {
      schema: {
        params: dateParamsSchema,
        querystring: dayQuerySchema,
        headers: mutationHeadersSchema,
        body: saveDraftRequestSchema,
        response: { 200: draftResponseSchema },
      },
      config: { policy: { action: "saveDraft", resourceResolver: depotResource } },
    },
    async (request) => {
      const { date } = request.params;
      const { depot } = request.query;
      const planningDay = await writableDay(depot, date);
      const day = await inputs(depot, date);
      const validation = validatePlan(toRulesPlan(request.body.data, day), day.reference.ref, day.validation);
      if (!validation.ok) throw validationFailed(validation);
      const draft = await writeDraft(planningDay, request.body.revision, request.body.data, actorId(request));
      return { draft: toDraftDto(draft) };
    },
  );

  app.post(
    "/api/dispatch/days/:date/validate",
    {
      schema: {
        params: dateParamsSchema,
        querystring: dayQuerySchema,
        headers: mutationHeadersSchema,
        body: validateRequestSchema,
        response: { 200: validationResultSchema },
      },
      config: { policy: { action: "validate", resourceResolver: depotResource } },
    },
    async (request) => {
      const day = await inputs(request.query.depot, request.params.date);
      return validatePlan(toRulesPlan(request.body.data, day), day.reference.ref, day.validation);
    },
  );

  /** A stored version as the wire DTO: the immutable snapshot plus its identity and summary. */
  function toVersionDto(v: PlanVersion): ApiDto<"planVersion"> {
    const snapshot = v.snapshot as Pick<ApiDto<"planVersion">, "trips" | "deferrals">;
    return {
      version: v.version,
      publishedAt: v.publishedAt.toISOString(),
      publishedBy: v.publishedBy,
      trips: snapshot.trips,
      deferrals: snapshot.deferrals,
      summary: v.summary as ApiDto<"planVersion">["summary"],
    };
  }

  app.post(
    "/api/dispatch/days/:date/publish",
    {
      schema: {
        params: dateParamsSchema,
        querystring: dayQuerySchema,
        headers: mutationHeadersSchema,
        body: publishRequestSchema,
        response: { 200: publishResponseSchema },
      },
      config: { policy: { action: "publish", resourceResolver: depotResource } },
    },
    async (request) => {
      const version = await publishDay(
        { prisma, clock, reference: deps.reference, notifier: deps.notifier },
        {
          depot: request.query.depot,
          date: request.params.date,
          revision: request.body.revision,
          actorUserId: actorId(request),
        },
      );
      return { plan: toVersionDto(version), serverTime: clock.now().toISOString() };
    },
  );

  app.get(
    "/api/dispatch/days/:date/versions",
    {
      schema: { params: dateParamsSchema, querystring: dayQuerySchema, response: { 200: versionsResponseSchema } },
      config: { policy: { action: "versions", resourceResolver: depotResource } },
    },
    async (request) => {
      const versions = await prisma.planVersion.findMany({
        where: { planningDay: { depot: request.query.depot, date: dateOnly(request.params.date) } },
        orderBy: { version: "asc" },
      });
      return { items: versions.map(toVersionDto) };
    },
  );

  app.get(
    "/api/dispatch/fleet",
    {
      schema: { querystring: dateQuerySchema, response: { 200: fleetResponseSchema } },
      config: { policy: { action: "getFleet", resourceResolver: collectionResource } },
    },
    async (request) => {
      const actor = request.actor;
      if (actor?.role !== "DISPATCHER") throw forbidden();
      const { date } = request.query;
      const vehicles = await prisma.vehicle.findMany({
        where: { depot: { in: [...actor.depots] } },
        include: {
          driver_vehicleId: { select: { name: true, phone: true } },
          vehicleAvailability_vehicleId: { where: { date: dateOnly(date) } },
        },
        orderBy: { displayId: "asc" },
      });
      const { ref } = await deps.reference.get();
      return {
        date,
        items: vehicles.map((v) => {
          const rules = ref.vehicles.get(v.displayId)!;
          const availability = v.vehicleAvailability_vehicleId[0];
          return {
            vehicle: {
              id: v.id,
              displayId: v.displayId,
              type: v.type,
              temp: v.temp,
              weightCapG: rules.weightCapG,
              volumeCapL: rules.volumeCapL,
              fuelType: v.fuelType,
              metresPerLitre: rules.metresPerLitre,
              weeklyFuelQuotaMl: rules.weeklyFuelQuotaMl,
              depot: v.depot,
              driver: {
                name: v.driver_vehicleId?.name ?? v.displayId,
                phone: v.driver_vehicleId?.phone ?? "unknown",
              },
            },
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
    },
  );
};
