// The rules core's ReferenceData, built from the seeded reference tables. Reference data is read-only at runtime, so
// it is loaded once; an empty (unseeded) database is not cached.
import {
  buildReferenceData,
  kgToGrams,
  kmPerLitreToMetresPerLitre,
  kmToMetres,
  litresToMillilitres,
  m3ToLitres,
  makeWindow,
  parseWindow,
  type ReferenceData,
} from "@nextdrop/rules";
import type { PrismaClient } from "../../generated/prisma/client";
import { localDateOf } from "../orders";

/** Display IDs (rules core) ↔ UUIDs (database, wire). */
export interface ReferenceIds {
  outletDisplay: ReadonlyMap<string, string>;
  vehicleDisplay: ReadonlyMap<string, string>;
  vehicleUuid: ReadonlyMap<string, string>;
}

export interface Reference {
  ref: ReferenceData;
  ids: ReferenceIds;
}

export function createReferenceSource(prisma: PrismaClient) {
  let cached: Promise<Reference> | undefined;

  async function load(): Promise<Reference> {
    const [outlets, vehicles, districts, allowances, days] = await Promise.all([
      prisma.outlet.findMany({ include: { district: { select: { name: true } } } }),
      prisma.vehicle.findMany(),
      prisma.district.findMany(),
      prisma.serviceAllowance.findMany(),
      prisma.calendarDay.findMany(),
    ]);
    if (outlets.length === 0 || vehicles.length === 0) cached = undefined;
    const ref = buildReferenceData({
      outlets: outlets.map((o) => ({
        id: o.displayId,
        brand: o.brand,
        district: o.district.name,
        depot: o.depot,
        dockType: o.dockType,
        parking: o.parkingConstraint,
        mallWindow: o.mallWindow ? parseWindow(o.mallWindow) : null,
        window: makeWindow(o.windowOpen, o.windowClose),
      })),
      vehicles: vehicles.map((v) => ({
        id: v.displayId,
        type: v.type,
        temp: v.temp,
        weightCapG: kgToGrams(v.weightCapKg.toNumber()),
        volumeCapL: m3ToLitres(v.volumeCapM3.toNumber()),
        fuelType: v.fuelType,
        metresPerLitre: kmPerLitreToMetresPerLitre(v.kmPerL.toNumber()),
        weeklyFuelQuotaMl: litresToMillilitres(v.weeklyFuelQuotaL.toNumber()),
        depot: v.depot,
      })),
      districts: districts.map((d) => ({
        district: d.name,
        depot: d.depot,
        roadClass: d.roadClass,
        depotToDistrictM: kmToMetres(d.depotToDistrictKm.toNumber()),
        depotToDistrictMin: d.depotToDistrictFreeflowMin,
        interStopM: kmToMetres(d.interStopKm.toNumber()),
        interStopMin: d.interStopFreeflowMin,
      })),
      serviceAllowances: allowances.map((s) => ({ brand: s.brand, dockType: s.dockType, minutes: s.minutes })),
      calendar: days.map((r) => ({
        date: localDateOf(r.date),
        dow: r.dow,
        isoYear: r.isoYear,
        isoWeek: r.isoWeek,
        isPayday: r.isPayday,
        festival: r.festival,
        festivalRamp: r.festivalRamp.toNumber(),
        isHoliday: r.isHoliday,
        monsoon: r.monsoon,
        isOperating: r.isOperating,
      })),
    });
    return {
      ref,
      ids: {
        outletDisplay: new Map(outlets.map((o) => [o.id, o.displayId])),
        vehicleDisplay: new Map(vehicles.map((v) => [v.id, v.displayId])),
        vehicleUuid: new Map(vehicles.map((v) => [v.displayId, v.id])),
      },
    };
  }

  return {
    get(): Promise<Reference> {
      cached ??= load().catch((error: unknown) => {
        cached = undefined;
        throw error;
      });
      return cached;
    },
  };
}

export type ReferenceSource = ReturnType<typeof createReferenceSource>;
