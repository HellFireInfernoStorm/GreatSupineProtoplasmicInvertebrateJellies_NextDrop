// Reference reads (spec/platform/api.md "Reference", ADR 0038): outlets, vehicles, products, calendar and reasons.
import {
  calendarQuerySchema,
  calendarResponseSchema,
  outletsResponseSchema,
  productsResponseSchema,
  reasonsResponseSchema,
  referenceQuerySchema,
  vehiclesResponseSchema,
  type ApiDto,
} from "@nextdrop/contracts";
import {
  addDays,
  calendarDay,
  daysBetween,
  kgToGrams,
  kmPerLitreToMetresPerLitre,
  litresToMillilitres,
  m3ToLitres,
} from "@nextdrop/rules";
import type { FastifyInstance } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { ApiHttpError } from "../../lib/errors";
import { createCalendarSource, outletInclude, toOutletDto, type CalendarSource } from "../orders";
import { collectionResource, scoped, type Actor } from "../policy";
import { reasonLists } from "./reasons";

export { LOAD_SHORT_REASONS, reasonLists, STOP_OUTCOME_REASONS } from "./reasons";

/** The longest calendar range one request may ask for (ADR 0038). */
export const MAX_CALENDAR_DAYS = 366;

export const vehicleInclude = { driver_vehicleId: true } satisfies Prisma.VehicleInclude;
export type VehicleRecord = Prisma.VehicleGetPayload<{ include: typeof vehicleInclude }>;

/** Capacity in grams and litres, economy in metres per litre, fuel quota in millilitres (api-dtos.md). */
export function toVehicleDto(vehicle: VehicleRecord): ApiDto<"vehicle"> {
  const driver = vehicle.driver_vehicleId;
  if (!driver) throw new Error(`Vehicle ${vehicle.displayId} has no Driver record`);
  return {
    id: vehicle.id,
    displayId: vehicle.displayId,
    type: vehicle.type,
    temp: vehicle.temp,
    weightCapG: kgToGrams(vehicle.weightCapKg.toNumber()),
    volumeCapL: m3ToLitres(vehicle.volumeCapM3.toNumber()),
    fuelType: vehicle.fuelType,
    metresPerLitre: kmPerLitreToMetresPerLitre(vehicle.kmPerL.toNumber()),
    weeklyFuelQuotaMl: litresToMillilitres(vehicle.weeklyFuelQuotaL.toNumber()),
    depot: vehicle.depot,
    driver: { name: driver.name, phone: driver.phone },
  };
}

/** `?depot=` narrows a list; it is ANDed with the actor's scope, so it can never widen it. */
const narrowed = <W>(scope: W, depot: string | undefined): W[] => (depot ? [scope, { depot } as W] : [scope]);

interface ReferenceDependencies {
  prisma: PrismaClient;
  calendar: CalendarSource;
}

const referenceRoutes: FastifyPluginAsyncZod<ReferenceDependencies> = async (app, deps) => {
  const { prisma } = deps;
  const actorOf = (request: { actor: Actor | null }) => request.actor!;

  app.get(
    "/api/ref/outlets",
    {
      schema: { querystring: referenceQuerySchema, response: { 200: outletsResponseSchema } },
      config: { policy: { action: "outlets", resourceResolver: collectionResource } },
    },
    async (request) => {
      const rows = await prisma.outlet.findMany({
        where: { AND: narrowed(scoped(actorOf(request)).outlets, request.query.depot) },
        include: outletInclude,
        orderBy: { displayId: "asc" },
      });
      return { items: rows.map(toOutletDto) };
    },
  );

  app.get(
    "/api/ref/vehicles",
    {
      schema: { querystring: referenceQuerySchema, response: { 200: vehiclesResponseSchema } },
      config: { policy: { action: "vehicles", resourceResolver: collectionResource } },
    },
    async (request) => {
      const rows = await prisma.vehicle.findMany({
        // A vehicle without a driver record cannot run a trip, and the DTO requires the driver contact.
        where: {
          AND: [
            ...narrowed(scoped(actorOf(request)).vehicles, request.query.depot),
            { driver_vehicleId: { isNot: null } },
          ],
        },
        include: vehicleInclude,
        orderBy: { displayId: "asc" },
      });
      return { items: rows.map(toVehicleDto) };
    },
  );

  app.get(
    "/api/ref/products",
    {
      schema: { querystring: referenceQuerySchema, response: { 200: productsResponseSchema } },
      config: { policy: { action: "products", resourceResolver: collectionResource } },
    },
    async (request) => {
      // Products have no depot. A store sees its own brand's catalogue; other roles see the whole catalogue.
      const actor = actorOf(request);
      let where: Prisma.ProductWhereInput = {};
      if (actor.role === "STORE") {
        const outlet = await prisma.outlet.findUnique({ where: { id: actor.outletId }, select: { brand: true } });
        if (!outlet) return { items: [] };
        where = { brand: outlet.brand };
      }
      const rows = await prisma.product.findMany({ where, orderBy: { sku: "asc" } });
      return {
        items: rows.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          brand: p.brand,
          tempRequirement: p.tempRequirement,
          unitLabel: p.unitLabel,
          // As stored: a unit can weigh a fraction of a gram, so no integer rounding here.
          unitWeightG: p.unitWeightKg.mul(1000).toNumber(),
          unitVolumeM3: p.unitVolumeM3.toNumber(),
        })),
      };
    },
  );

  app.get(
    "/api/ref/calendar",
    {
      schema: { querystring: calendarQuerySchema, response: { 200: calendarResponseSchema } },
      config: { policy: { action: "calendar", resourceResolver: collectionResource } },
    },
    async (request) => {
      const { from, to } = request.query;
      const span = daysBetween(from, to);
      if (span < 0 || span >= MAX_CALENDAR_DAYS) {
        throw new ApiHttpError(400, "SCHEMA_INVALID", "errors.schemaInvalid", { field: "to" });
      }
      // Every date in the range: a date the reference table lacks follows the rules defaults (ADR 0018).
      const calendar = await deps.calendar.get();
      const items = Array.from({ length: span + 1 }, (_, i) => calendarDay(addDays(from, i), calendar));
      return { items };
    },
  );

  app.get(
    "/api/ref/reasons",
    {
      schema: { response: { 200: reasonsResponseSchema } },
      config: { policy: { action: "reasons", resourceResolver: collectionResource } },
    },
    async () => reasonLists(),
  );
};

export async function registerReference(app: FastifyInstance, deps: { prisma: PrismaClient | null }) {
  if (!deps.prisma) return;
  await app.register(referenceRoutes, {
    prisma: deps.prisma,
    calendar: createCalendarSource(deps.prisma),
  });
}
