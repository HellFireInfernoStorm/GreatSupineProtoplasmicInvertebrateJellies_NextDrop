import type { FieldSnapshot } from "@nextdrop/contracts";
import { kgToGrams, kmPerLitreToMetresPerLitre, litresToMillilitres, m3ToLitres } from "@nextdrop/rules";
import type { PrismaClient } from "../../generated/prisma/client";
import { readFeedHint } from "../feed";
import { dateOnly, orderInclude, toOrderDto, toTripDto, tripInclude } from "../orders";
import type { Actor } from "../policy";
import { snapshotConfig } from "./config";

type FieldActor = Extract<Actor, { role: "LOADER" | "DRIVER" }>;

/**
 * `GET /field/snapshot` (spec/sync/change-feed.md): the server-derived tables a field device replaces in one
 * transaction. It never contains or touches the outbox.
 */
export async function buildSnapshot(
  prisma: PrismaClient,
  actor: FieldActor,
  date: string,
  now: Date,
): Promise<FieldSnapshot> {
  const day = await prisma.planningDay.findUnique({
    where: { depot_date: { depot: actor.depot, date: dateOnly(date) } },
    select: { currentVersion: true },
  });
  const hint = await readFeedHint(prisma);
  const base = {
    // Stored zero means "not yet published" (api-dtos.md).
    planVersion: day && day.currentVersion > 0 ? day.currentVersion : null,
    serverTime: now.toISOString(),
    feedCursor: hint.head,
    resetEpoch: hint.resetEpoch,
    config: snapshotConfig(),
  };
  const onDate = { date: dateOnly(date) };

  if (actor.role === "DRIVER") {
    const vehicle = await prisma.vehicle.findUniqueOrThrow({
      where: { id: actor.vehicleId },
      include: { driver_vehicleId: true },
    });
    const driver = vehicle.driver_vehicleId;
    if (!driver) throw new Error(`Vehicle ${vehicle.displayId} has no Driver record`);
    const trips = await prisma.trip.findMany({
      where: { vehicleId: actor.vehicleId, status: { not: "CANCELLED" }, planningDay: onDate },
      include: tripInclude(),
      orderBy: { tripNo: "asc" },
    });
    return {
      ...base,
      role: "DRIVER",
      scope: {
        date,
        vehicle: {
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
        },
        trips: trips.map(toTripDto),
      },
    };
  }

  const [trips, loaded] = await Promise.all([
    prisma.trip.findMany({
      where: { status: { not: "CANCELLED" }, planningDay: { ...onDate, depot: actor.depot } },
      include: tripInclude(),
      orderBy: [{ plannedDepart: "asc" }, { displayId: "asc" }],
    }),
    // Load reversals the loader must carry out (ADR 0004, ADR 0026): the depot's LOADED orders for the date with a
    // pending reversal, whether or not the current plan still contains them.
    prisma.order.findMany({
      where: { status: "LOADED", currentDate: dateOnly(date), outlet: { depot: actor.depot } },
      include: orderInclude,
      orderBy: { id: "asc" },
    }),
  ]);
  return {
    ...base,
    role: "LOADER",
    scope: {
      depot: actor.depot,
      date,
      trips: trips.map(toTripDto),
      reversals: loaded.map(toOrderDto).filter((order) => order.pendingReversal !== null),
    },
  };
}
