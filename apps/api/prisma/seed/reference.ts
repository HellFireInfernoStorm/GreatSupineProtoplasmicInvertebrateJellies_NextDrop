// Reference tables from the approved data/reference/*.csv files (seed-and-demo.md §15.1 item 1).
// Each row is keyed by its natural key and written only when it is missing or differs from the CSV.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BRANDS,
  DOCK_TYPES,
  PARKING_CONSTRAINTS,
  parseClock,
  VEHICLE_TEMPS,
  VEHICLE_TYPES,
  type CsvRow,
} from "@nextdrop/rules";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { parseCsv } from "./pick-fixtures";
import { syncRows, type SyncResult } from "./sync";

/** Every approved reference file (scripts/agent-context/config.json `referenceCsvAllowed`). */
export const SEED_REFERENCE_FILES = [
  "outlets.csv",
  "vehicles.csv",
  "calendar.csv",
  "district_travel.csv",
  "service_allowance.csv",
  "traffic_speed.csv",
  "road_conditions.csv",
] as const;
export type SeedReferenceFile = (typeof SEED_REFERENCE_FILES)[number];

const REFERENCE_DIR = fileURLToPath(new URL("../../../../data/reference/", import.meta.url));

export function readReferenceRows(file: SeedReferenceFile): CsvRow[] {
  return parseCsv(readFileSync(REFERENCE_DIR + file, "utf8"));
}

function text(row: CsvRow, name: string): string {
  const v = row[name]?.trim();
  if (v === undefined) throw new RangeError(`missing column "${name}"`);
  return v;
}

function oneOf<T extends string>(row: CsvRow, name: string, allowed: readonly T[]): T {
  const v = text(row, name);
  if (!(allowed as readonly string[]).includes(v)) throw new RangeError(`column "${name}": "${v}" is not allowed`);
  return v as T;
}

function int(row: CsvRow, name: string): number {
  const n = Number(text(row, name));
  if (!Number.isInteger(n)) throw new RangeError(`column "${name}": "${text(row, name)}" is not an integer`);
  return n;
}

/** A decimal column, kept as its CSV text so Prisma stores it exactly. */
function decimal(row: CsvRow, name: string): string {
  const v = text(row, name);
  if (v === "" || !Number.isFinite(Number(v))) throw new RangeError(`column "${name}": "${v}" is not a number`);
  return v;
}

function flag(row: CsvRow, name: string): boolean {
  return int(row, name) === 1;
}

/** A `YYYY-MM-DD` date column as the UTC midnight Prisma uses for `@db.Date`. */
export function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export interface ReferenceIds {
  /** District UUID by name. */
  readonly districts: ReadonlyMap<string, string>;
  /** Outlet UUID by display ID. */
  readonly outlets: ReadonlyMap<string, string>;
  /** Vehicle UUID by display ID. */
  readonly vehicles: ReadonlyMap<string, string>;
}

export async function seedReference(
  db: PrismaClient,
  read: (file: SeedReferenceFile) => CsvRow[] = readReferenceRows,
): Promise<{ ids: ReferenceIds; result: SyncResult }> {
  const result: SyncResult = { created: 0, updated: 0 };
  const add = (r: SyncResult) => {
    result.created += r.created;
    result.updated += r.updated;
  };

  add(
    await syncRows({
      rows: read("district_travel.csv").map((r) => ({
        name: text(r, "district"),
        depot: text(r, "depot"),
        roadClass: text(r, "road_class"),
        freeFlowKmh: decimal(r, "free_flow_kmh"),
        depotToDistrictKm: decimal(r, "depot_to_district_km"),
        depotToDistrictFreeflowMin: int(r, "depot_to_district_freeflow_min"),
        interStopKm: decimal(r, "inter_stop_km"),
        interStopFreeflowMin: int(r, "inter_stop_freeflow_min"),
      })),
      key: (r) => r.name,
      existing: () => db.district.findMany(),
      create: (rows) => db.district.createMany({ data: rows }),
      update: (id, data) => db.district.update({ where: { id }, data }),
    }),
  );
  const districts = new Map((await db.district.findMany()).map((d) => [d.name, d.id]));
  const districtId = (name: string) => {
    const id = districts.get(name);
    if (!id) throw new RangeError(`unknown district ${name}`);
    return id;
  };

  add(
    await syncRows({
      rows: read("outlets.csv").map((r) => ({
        displayId: text(r, "outlet_id"),
        brand: oneOf(r, "brand", BRANDS),
        depot: text(r, "depot"),
        dockType: oneOf(r, "dock_type", DOCK_TYPES),
        parkingConstraint: oneOf(r, "parking_constraint", PARKING_CONSTRAINTS),
        mallWindow: text(r, "mall_window") || null,
        windowOpen: parseClock(text(r, "window_open_time")),
        windowClose: parseClock(text(r, "window_close_time")),
        districtId: districtId(text(r, "district")),
      })),
      key: (r) => r.displayId,
      existing: () => db.outlet.findMany(),
      create: (rows) => db.outlet.createMany({ data: rows }),
      update: (id, data) => db.outlet.update({ where: { id }, data }),
    }),
  );

  add(
    await syncRows({
      rows: read("vehicles.csv").map((r) => ({
        displayId: text(r, "vehicle_id"),
        type: oneOf(r, "type", VEHICLE_TYPES),
        temp: oneOf(r, "temp", VEHICLE_TEMPS),
        weightCapKg: decimal(r, "weight_cap_kg"),
        volumeCapM3: decimal(r, "volume_cap_m3"),
        fuelType: text(r, "fuel_type"),
        kmPerL: decimal(r, "km_per_l"),
        weeklyFuelQuotaL: decimal(r, "weekly_fuel_quota_l"),
        depot: text(r, "depot"),
      })),
      key: (r) => r.displayId,
      existing: () => db.vehicle.findMany(),
      create: (rows) => db.vehicle.createMany({ data: rows }),
      update: (id, data) => db.vehicle.update({ where: { id }, data }),
    }),
  );

  add(
    await syncRows({
      rows: read("service_allowance.csv").map((r) => ({
        brand: oneOf(r, "brand", BRANDS),
        dockType: oneOf(r, "dock_type", DOCK_TYPES),
        minutes: int(r, "service_allowance_min"),
      })),
      key: (r) => `${r.brand}|${r.dockType}`,
      existing: () => db.serviceAllowance.findMany(),
      create: (rows) => db.serviceAllowance.createMany({ data: rows }),
      update: (id, data) => db.serviceAllowance.update({ where: { id }, data }),
    }),
  );

  add(
    await syncRows({
      rows: read("calendar.csv").map((r) => ({
        date: dateOnly(text(r, "date")),
        dow: int(r, "dow"),
        isoYear: int(r, "iso_year"),
        isoWeek: int(r, "iso_week"),
        isPayday: flag(r, "is_payday"),
        festival: text(r, "festival") || null,
        festivalRamp: decimal(r, "festival_ramp"),
        isHoliday: flag(r, "is_holiday"),
        monsoon: flag(r, "monsoon"),
        isOperating: flag(r, "is_operating"),
      })),
      key: (r) => r.date.toISOString(),
      existing: () => db.calendarDay.findMany(),
      create: (rows) => db.calendarDay.createMany({ data: rows }),
      update: (id, data) => db.calendarDay.update({ where: { id }, data }),
    }),
  );

  add(
    await syncRows({
      rows: read("traffic_speed.csv").map((r) => ({
        districtId: districtId(text(r, "district")),
        hour: int(r, "hour"),
        monsoon: flag(r, "monsoon"),
        speedIndex: decimal(r, "speed_index"),
      })),
      key: (r) => `${r.districtId}|${r.hour}|${r.monsoon}`,
      existing: () => db.trafficSpeed.findMany(),
      create: (rows) => db.trafficSpeed.createMany({ data: rows }),
      update: (id, data) => db.trafficSpeed.update({ where: { id }, data }),
    }),
  );

  add(
    await syncRows({
      rows: read("road_conditions.csv").map((r) => ({
        districtId: districtId(text(r, "district")),
        date: dateOnly(text(r, "date")),
        disruptionIndex: decimal(r, "disruption_index"),
      })),
      key: (r) => `${r.districtId}|${r.date.toISOString()}`,
      existing: () => db.roadCondition.findMany(),
      create: (rows) => db.roadCondition.createMany({ data: rows }),
      update: (id, data) => db.roadCondition.update({ where: { id }, data }),
    }),
  );

  const outlets = new Map((await db.outlet.findMany()).map((o) => [o.displayId, o.id]));
  const vehicles = new Map((await db.vehicle.findMany()).map((v) => [v.displayId, v.id]));
  return { ids: { districts, outlets, vehicles }, result };
}
