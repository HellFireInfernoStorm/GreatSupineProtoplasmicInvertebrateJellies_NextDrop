// Picks the story fixtures from the approved reference CSVs (spec/data/seed-and-demo.md §15.5, ADR 0008, ADR 0027)
// and writes them to story-fixtures.ts. Run with `pnpm seed:pick-fixtures`.
// Deterministic: candidates are sorted by ID, and every feasibility question is asked of `packages/rules`.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildReferenceData,
  calendarDayFromRow,
  computeEtas,
  districtTravelFromRow,
  outletFromRow,
  serviceAllowanceFromRow,
  validateTrip,
  vehicleFromRow,
  type CsvRow,
  type Outlet,
  type PlanOrder,
  type PlanTrip,
  type ReferenceData,
  type Vehicle,
} from "@nextdrop/rules";

/** The only files the picker reads, all from `data/reference/`. */
export const REFERENCE_FILES = [
  "outlets.csv",
  "vehicles.csv",
  "district_travel.csv",
  "service_allowance.csv",
  "calendar.csv",
] as const;
export type ReferenceFile = (typeof REFERENCE_FILES)[number];
export type ReadReference = (file: ReferenceFile) => string;

const REFERENCE_DIR = fileURLToPath(new URL("../../../../data/reference/", import.meta.url));
export const OUTPUT_FILE = fileURLToPath(new URL("./story-fixtures.ts", import.meta.url));

/** Tue 29 Sep 2026, the story day (design/mock-story.md). The hill trip is validated for this date. */
export const STORY_DATE = "2026-09-29";
export const PELIYAGODA = "Peliyagoda";
export const KANDY = "Kandy";
/** The peak-day store's district. `outlets.csv` has no locality column, so Wellawatte itself cannot be matched. */
export const PEAK_STORE_DISTRICT = "Colombo";
/** Talawakele lies in Nuwara Eliya district, a `hill` district served from Kandy. */
export const HILL_DISTRICT = "Nuwara Eliya";
/** The D4 "no signal" card reads "stop 3 of 5". */
export const HILL_TRIP_MAX_STOPS = 5;
/** Walkthrough steps 8 to 11 need one online stop, two offline stops and a later stop to edit. */
export const HILL_TRIP_MIN_STOPS = 4;
/** Stop 1 is delivered online (step 8); stop 2 is the first delivered offline, so its store sees the late confirm. */
export const STORE_STOP_INDEX = 1;
/** Seeded loader logins: LDR001 is Peliyagoda (§15.3), the next one is the Kandy loader. */
export const KANDY_LOADER_LOGIN_ID = "LDR002";

export interface StoryFixtures {
  readonly storyDate: string;
  readonly peakDay: {
    readonly depot: string;
    readonly district: string;
    /** Dilini's outlet. Replaces the design placeholder `OUT015`. */
    readonly storeOutletId: string;
  };
  readonly hillRun: {
    readonly depot: string;
    readonly district: string;
    /** Replaces the design placeholder `VEH001`. */
    readonly vehicleId: string;
    readonly driverId: string;
    /** Replaces the design placeholder `T001`. Its display ID is assigned when the plan is proposed. */
    readonly trip: {
      readonly vehicleId: string;
      readonly tripNo: number;
      readonly brand: Outlet["brand"];
      readonly district: string;
      /** Outlet IDs in delivery order, as `computeEtas` sequences them. */
      readonly stopOutletIds: readonly string[];
    };
    /** The outlet receiving the walkthrough delivery (the store's delayed-confirmation view). */
    readonly storeOutletId: string;
    readonly loaderLoginId: string;
  };
}

/** Parses a reference CSV. The files use no quoted fields. */
export function parseCsv(text: string): CsvRow[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const cols = (header ?? "").split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]));
  });
}

export const readCommittedReference: ReadReference = (file) => readFileSync(REFERENCE_DIR + file, "utf8");

export function loadReference(read: ReadReference = readCommittedReference): ReferenceData {
  const rows = (file: ReferenceFile) => parseCsv(read(file));
  return buildReferenceData({
    outlets: rows("outlets.csv").map(outletFromRow),
    vehicles: rows("vehicles.csv").map(vehicleFromRow),
    districts: rows("district_travel.csv").map(districtTravelFromRow),
    serviceAllowances: rows("service_allowance.csv").map(serviceAllowanceFromRow),
    calendar: rows("calendar.csv").map(calendarDayFromRow),
  });
}

export function pickStoryFixtures(ref: ReferenceData): StoryFixtures {
  return {
    storyDate: STORY_DATE,
    peakDay: { depot: PELIYAGODA, district: PEAK_STORE_DISTRICT, storeOutletId: pickPeakStore(ref).id },
    hillRun: pickHillRun(ref),
  };
}

/**
 * The first Colombo Fresh outlet served from Peliyagoda, by outlet ID, that a Peliyagoda reefer truck can serve on a
 * clean single-stop Fresh trip. Every Colombo outlet is the same distance from the depot in the reference data.
 */
function pickPeakStore(ref: ReferenceData): Outlet {
  const trucks = byId([...ref.vehicles.values()].filter((v) => isReeferTruck(v, PELIYAGODA)));
  const outlets = byId(
    [...ref.outlets.values()].filter(
      (o) => o.brand === "Fresh" && o.depot === PELIYAGODA && o.district === PEAK_STORE_DISTRICT,
    ),
  );
  const truck = trucks[0];
  const pick = truck && outlets.find((o) => isClean(tripFor(truck, [o]), ref));
  if (!pick) throw new Error(`no ${PEAK_STORE_DISTRICT} Fresh outlet a ${PELIYAGODA} reefer truck can serve`);
  return pick;
}

/**
 * The first Kandy reefer truck, by vehicle ID, whose Fresh trip 1 to the hill district takes at least
 * `HILL_TRIP_MIN_STOPS` of that district's Fresh outlets. Outlets are added in ID order while the trip stays clean.
 */
function pickHillRun(ref: ReferenceData): StoryFixtures["hillRun"] {
  const district = ref.districts.get(HILL_DISTRICT);
  if (district?.depot !== KANDY || district.roadClass !== "hill")
    throw new Error(`${HILL_DISTRICT} is not a hill district served from ${KANDY}`);
  const outlets = byId(
    [...ref.outlets.values()].filter((o) => o.brand === "Fresh" && o.depot === KANDY && o.district === HILL_DISTRICT),
  );

  for (const vehicle of byId([...ref.vehicles.values()].filter((v) => isReeferTruck(v, KANDY)))) {
    const stops: Outlet[] = [];
    for (const outlet of outlets) {
      if (stops.length === HILL_TRIP_MAX_STOPS) break;
      if (isClean(tripFor(vehicle, [...stops, outlet]), ref)) stops.push(outlet);
    }
    if (stops.length < HILL_TRIP_MIN_STOPS) continue;

    const stopOutletIds = computeEtas(tripFor(vehicle, stops), ref).map((eta) => eta.outletId);
    return {
      depot: KANDY,
      district: HILL_DISTRICT,
      vehicleId: vehicle.id,
      driverId: driverIdFor(vehicle.id),
      trip: { vehicleId: vehicle.id, tripNo: 1, brand: "Fresh", district: HILL_DISTRICT, stopOutletIds },
      storeOutletId: stopOutletIds[STORE_STOP_INDEX] as string,
      loaderLoginId: KANDY_LOADER_LOGIN_ID,
    };
  }
  throw new Error(`no ${KANDY} reefer truck can run ${HILL_TRIP_MIN_STOPS}+ Fresh stops in ${HILL_DISTRICT}`);
}

/** Driver display IDs follow the vehicle number: `DRV001` drives `VEH001`. */
export function driverIdFor(vehicleId: string): string {
  return vehicleId.replace(/^VEH/, "DRV");
}

function isReeferTruck(v: Vehicle, depot: string): boolean {
  return v.depot === depot && v.temp === "reefer" && v.type === "truck";
}

function byId<T extends { readonly id: string }>(items: T[]): T[] {
  return items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** A Fresh trip 1 carrying one small chilled order per outlet. */
function tripFor(vehicle: Vehicle, outlets: readonly Outlet[]): PlanTrip {
  const orders = outlets.map((o): PlanOrder => ({
    id: `fixture-${o.id}`,
    outletId: o.id,
    temp: "chilled",
    weightG: 1000,
    volumeL: 1,
    deliveryDate: STORY_DATE,
  }));
  return { ref: "fixture", vehicleId: vehicle.id, tripNo: 1, orders };
}

/** No hard violation and no warning: within budget, on time on both ETAs, right vehicle for every stop. */
function isClean(trip: PlanTrip, ref: ReferenceData): boolean {
  return validateTrip(trip, ref, { date: STORY_DATE }).violations.length === 0;
}

/** The generated module, formatted as Prettier would leave it. */
export function renderStoryFixtures(f: StoryFixtures): string {
  const q = (s: string) => JSON.stringify(s);
  const { peakDay: peak, hillRun: hill } = f;
  return `// Generated by \`pnpm seed:pick-fixtures\` (apps/api/prisma/seed/pick-fixtures.ts) from data/reference/*.csv.
// Do not edit by hand: change the criteria in the picker and run it again. ADR 0008, ADR 0027, seed-and-demo.md §15.5.
// Seed, e2e tests and docs import the story fixtures from here.

/** Tue 29 Sep 2026, the story delivery day. */
export const STORY_DATE = ${q(f.storyDate)};

// Peliyagoda peak day: walkthrough steps 1 to 6 (store and dispatcher).
export const PEAK_DAY_DEPOT = ${q(peak.depot)};
export const PEAK_STORE_DISTRICT = ${q(peak.district)};
/** Dilini's outlet, Waypoint Fresh. Replaces the design placeholder \`OUT015\`. */
export const PEAK_STORE_OUTLET_ID = ${q(peak.storeOutletId)};

// Kandy hill run: walkthrough steps 7 to 14 (loader, driver, no-signal card, delayed confirmation).
export const HILL_RUN_DEPOT = ${q(hill.depot)};
/** The low-coverage hill district (Talawakele area). */
export const HILL_DISTRICT = ${q(hill.district)};
/** Sampath's reefer truck. Replaces the design placeholder \`VEH001\`. */
export const WALKTHROUGH_VEHICLE_ID = ${q(hill.vehicleId)};
/** Sampath, the walkthrough driver. */
export const WALKTHROUGH_DRIVER_ID = ${q(hill.driverId)};
/**
 * The hill trip. Replaces the design placeholder \`T001\`; its display ID is assigned when the plan is proposed.
 * Stops are in delivery order.
 */
export const WALKTHROUGH_TRIP = {
  vehicleId: ${q(hill.trip.vehicleId)},
  tripNo: ${hill.trip.tripNo},
  brand: ${q(hill.trip.brand)},
  district: ${q(hill.trip.district)},
  stopOutletIds: [${hill.trip.stopOutletIds.map(q).join(", ")}],
} as const;
/** The store receiving the walkthrough delivery: stop ${STORE_STOP_INDEX + 1}, the first one delivered offline. */
export const HILL_STORE_OUTLET_ID = ${q(hill.storeOutletId)};
/** The Kandy loader account. */
export const KANDY_LOADER_LOGIN_ID = ${q(hill.loaderLoginId)};
`;
}

function main(): void {
  const fixtures = pickStoryFixtures(loadReference());
  writeFileSync(OUTPUT_FILE, renderStoryFixtures(fixtures));
  console.log(`wrote ${OUTPUT_FILE}`);
  console.log(JSON.stringify(fixtures, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
