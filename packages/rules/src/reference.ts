// Reference data as the rules core sees it: integer units, parsed windows (spec/domain/units-and-time.md).
// The `*FromRow` helpers turn one `data/reference/*.csv` row (header -> string) into these types; the caller reads the file.
import type { CalendarDay, LocalDate } from "./calendar";
import { dayNumber } from "./calendar";
import type { Grams, Litres, Metres, Millilitres, Minutes, TimeWindow } from "./units";
import {
  kgToGrams,
  kmPerLitreToMetresPerLitre,
  kmToMetres,
  litresToMillilitres,
  m3ToLitres,
  makeWindow,
  parseClock,
  parseWindow,
} from "./units";

export const BRANDS = ["Fresh", "Style", "Tech"] as const;
export type Brand = (typeof BRANDS)[number];

export const DOCK_TYPES = ["rear_dock", "street", "mall_bay"] as const;
export type DockType = (typeof DOCK_TYPES)[number];

export const PARKING_CONSTRAINTS = ["normal", "van_only", "mall_dock"] as const;
export type ParkingConstraint = (typeof PARKING_CONSTRAINTS)[number];

export const VEHICLE_TYPES = ["truck", "van"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_TEMPS = ["reefer", "ambient"] as const;
export type VehicleTemp = (typeof VEHICLE_TEMPS)[number];

export const TEMP_REQUIREMENTS = ["chilled", "ambient"] as const;
export type TempRequirement = (typeof TEMP_REQUIREMENTS)[number];

export interface Outlet {
  readonly id: string;
  readonly brand: Brand;
  readonly district: string;
  readonly depot: string;
  readonly dockType: DockType;
  readonly parking: ParkingConstraint;
  /** The mall's fixed access window, or null outside malls. */
  readonly mallWindow: TimeWindow | null;
  /** The outlet's requested delivery window. */
  readonly window: TimeWindow;
}

export interface Vehicle {
  readonly id: string;
  readonly type: VehicleType;
  readonly temp: VehicleTemp;
  /** Per trip. */
  readonly weightCapG: Grams;
  /** Per trip. */
  readonly volumeCapL: Litres;
  readonly fuelType: string;
  /** `km_per_l` in metres per litre. */
  readonly metresPerLitre: number;
  readonly weeklyFuelQuotaMl: Millilitres;
  readonly depot: string;
}

export interface DistrictTravel {
  readonly district: string;
  readonly depot: string;
  readonly roadClass: string;
  readonly depotToDistrictM: Metres;
  readonly depotToDistrictMin: Minutes;
  readonly interStopM: Metres;
  readonly interStopMin: Minutes;
}

export interface ServiceAllowance {
  readonly brand: Brand;
  readonly dockType: DockType;
  readonly minutes: Minutes;
}

/** The reference data a rules call needs, keyed for lookup. A `Map` satisfies each lookup. */
export interface ReferenceData {
  readonly outlets: ReadonlyMap<string, Outlet>;
  readonly vehicles: ReadonlyMap<string, Vehicle>;
  /** Keyed by district name. */
  readonly districts: ReadonlyMap<string, DistrictTravel>;
  /** Keyed by `serviceAllowanceKey(brand, dockType)`. */
  readonly serviceAllowances: ReadonlyMap<string, ServiceAllowance>;
  readonly calendar: ReadonlyMap<LocalDate, CalendarDay>;
}

export function serviceAllowanceKey(brand: Brand, dockType: DockType): string {
  return `${brand}|${dockType}`;
}

/** Builds `ReferenceData` maps from lists. Throws on a duplicate key. */
export function buildReferenceData(lists: {
  outlets: readonly Outlet[];
  vehicles: readonly Vehicle[];
  districts: readonly DistrictTravel[];
  serviceAllowances: readonly ServiceAllowance[];
  calendar: readonly CalendarDay[];
}): ReferenceData {
  return {
    outlets: keyBy(lists.outlets, (o) => o.id, "outlet"),
    vehicles: keyBy(lists.vehicles, (v) => v.id, "vehicle"),
    districts: keyBy(lists.districts, (d) => d.district, "district"),
    serviceAllowances: keyBy(
      lists.serviceAllowances,
      (s) => serviceAllowanceKey(s.brand, s.dockType),
      "service allowance",
    ),
    calendar: keyBy(lists.calendar, (c) => c.date, "calendar date"),
  };
}

function keyBy<T>(items: readonly T[], key: (t: T) => string, what: string): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    const k = key(item);
    if (map.has(k)) throw new RangeError(`duplicate ${what}: ${k}`);
    map.set(k, item);
  }
  return map;
}

// ---- CSV rows -------------------------------------------------------------------------------------------------------

export type CsvRow = Readonly<Record<string, string | undefined>>;

function field(row: CsvRow, name: string): string {
  const v = row[name];
  if (v === undefined) throw new RangeError(`missing column "${name}"`);
  return v.trim();
}

function oneOf<T extends string>(row: CsvRow, name: string, allowed: readonly T[]): T {
  const v = field(row, name);
  if (!(allowed as readonly string[]).includes(v))
    throw new RangeError(`column "${name}": "${v}" is not one of ${allowed.join(", ")}`);
  return v as T;
}

function num(row: CsvRow, name: string): number {
  const v = field(row, name);
  const n = Number(v);
  if (v === "" || !Number.isFinite(n)) throw new RangeError(`column "${name}": "${v}" is not a number`);
  return n;
}

function int(row: CsvRow, name: string): number {
  const n = num(row, name);
  if (!Number.isInteger(n)) throw new RangeError(`column "${name}": ${n} is not an integer`);
  return n;
}

function flag(row: CsvRow, name: string): boolean {
  const n = int(row, name);
  if (n !== 0 && n !== 1) throw new RangeError(`column "${name}": ${n} is not 0 or 1`);
  return n === 1;
}

/** One row of `outlets.csv`. */
export function outletFromRow(row: CsvRow): Outlet {
  const mall = field(row, "mall_window");
  return {
    id: field(row, "outlet_id"),
    brand: oneOf(row, "brand", BRANDS),
    district: field(row, "district"),
    depot: field(row, "depot"),
    dockType: oneOf(row, "dock_type", DOCK_TYPES),
    parking: oneOf(row, "parking_constraint", PARKING_CONSTRAINTS),
    mallWindow: mall ? parseWindow(mall) : null,
    window: makeWindow(parseClock(field(row, "window_open_time")), parseClock(field(row, "window_close_time"))),
  };
}

/** One row of `vehicles.csv`. */
export function vehicleFromRow(row: CsvRow): Vehicle {
  return {
    id: field(row, "vehicle_id"),
    type: oneOf(row, "type", VEHICLE_TYPES),
    temp: oneOf(row, "temp", VEHICLE_TEMPS),
    weightCapG: kgToGrams(num(row, "weight_cap_kg")),
    volumeCapL: m3ToLitres(num(row, "volume_cap_m3")),
    fuelType: field(row, "fuel_type"),
    metresPerLitre: kmPerLitreToMetresPerLitre(num(row, "km_per_l")),
    weeklyFuelQuotaMl: litresToMillilitres(num(row, "weekly_fuel_quota_l")),
    depot: field(row, "depot"),
  };
}

/** One row of `district_travel.csv`. */
export function districtTravelFromRow(row: CsvRow): DistrictTravel {
  return {
    district: field(row, "district"),
    depot: field(row, "depot"),
    roadClass: field(row, "road_class"),
    depotToDistrictM: kmToMetres(num(row, "depot_to_district_km")),
    depotToDistrictMin: int(row, "depot_to_district_freeflow_min"),
    interStopM: kmToMetres(num(row, "inter_stop_km")),
    interStopMin: int(row, "inter_stop_freeflow_min"),
  };
}

/** One row of `service_allowance.csv`. */
export function serviceAllowanceFromRow(row: CsvRow): ServiceAllowance {
  return {
    brand: oneOf(row, "brand", BRANDS),
    dockType: oneOf(row, "dock_type", DOCK_TYPES),
    minutes: int(row, "service_allowance_min"),
  };
}

/** One row of `calendar.csv`. */
export function calendarDayFromRow(row: CsvRow): CalendarDay {
  const date = field(row, "date");
  dayNumber(date);
  const festival = field(row, "festival");
  return {
    date,
    dow: int(row, "dow"),
    isoYear: int(row, "iso_year"),
    isoWeek: int(row, "iso_week"),
    isPayday: flag(row, "is_payday"),
    festival: festival || null,
    festivalRamp: num(row, "festival_ramp"),
    isHoliday: flag(row, "is_holiday"),
    monsoon: flag(row, "monsoon"),
    isOperating: flag(row, "is_operating"),
  };
}
