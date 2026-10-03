// The Peliyagoda peak day (seed-and-demo.md §15.1 item 4): bulk orders generated from a fixed PRNG seed, so every run
// produces the same orders. Story fixtures live in story.ts; this file only generates bulk.
//
// Brand ordering guidance (ADR 0010) is followed throughout: a Fresh outlet orders dry goods and, separately, chilled
// goods, so it can have two orders for the day; a Style outlet has one weekly order; Tech orders are a few large items.
import {
  addDays,
  type Brand,
  type Calendar,
  type LocalDate,
  type Outlet,
  type ReferenceData,
  type TempRequirement,
} from "@nextdrop/rules";
import { productsFor } from "./catalogue";
import { colomboIso, deferral, type OrderLineSpec, type OrderSpec } from "./orders";
import { PEAK_DAY_DEPOT, PEAK_STORE_OUTLET_ID, STORY_DATE } from "./story-fixtures";

export const PEAK_DAY_SEED = 29;

/** Orders per kind. 40 + 24 > 48 Fresh outlets, so at least 16 outlets have both a dry and a chilled order. */
export const PEAK_DAY_MIX = { freshDry: 40, freshChilled: 24, style: 13, tech: 9 } as const;
export const PEAK_DAY_ORDER_COUNT =
  PEAK_DAY_MIX.freshDry + PEAK_DAY_MIX.freshChilled + PEAK_DAY_MIX.style + PEAK_DAY_MIX.tech;

/** Share of orders carried over from yesterday's run, and of those, the share deferred twice. */
const DEFERRED_SHARE = 0.12;
const TWICE_SHARE = 0.3;

/**
 * Vehicles in the workshop on the peak day, chosen so demand exceeds capacity: `proposePlan` serves 80 of the 86
 * orders and defers 6, mostly for want of a reefer (checked in the tests). Four reefer trucks, a reefer van and an
 * ambient van are among them; one is a breakdown (ADR 0017).
 */
export const PEAK_DAY_WORKSHOP: readonly {
  readonly vehicleId: string;
  readonly reason: "SERVICE" | "BREAKDOWN";
}[] = [
  { vehicleId: "VEH003", reason: "SERVICE" },
  { vehicleId: "VEH004", reason: "SERVICE" },
  { vehicleId: "VEH005", reason: "BREAKDOWN" },
  { vehicleId: "VEH006", reason: "SERVICE" },
  { vehicleId: "VEH011", reason: "SERVICE" },
  { vehicleId: "VEH014", reason: "SERVICE" },
  { vehicleId: "VEH017", reason: "SERVICE" },
  { vehicleId: "VEH021", reason: "SERVICE" },
  { vehicleId: "VEH026", reason: "SERVICE" },
  { vehicleId: "VEH030", reason: "SERVICE" },
  { vehicleId: "VEH034", reason: "SERVICE" },
  { vehicleId: "VEH036", reason: "SERVICE" },
  { vehicleId: "VEH037", reason: "SERVICE" },
];

/** Small deterministic PRNG (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rnd: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function between(rnd: () => number, lo: number, hi: number): number {
  return Math.round(lo + rnd() * (hi - lo));
}

/** Target order weight in kg, and how many SKUs, by kind. */
const PROFILE: Record<string, { kg: [number, number]; skus: [number, number] }> = {
  "Fresh|ambient": { kg: [300, 900], skus: [3, 4] },
  "Fresh|chilled": { kg: [200, 600], skus: [2, 3] },
  "Style|ambient": { kg: [150, 450], skus: [2, 3] },
  "Tech|ambient": { kg: [400, 1300], skus: [1, 2] },
};

function linesFor(brand: Brand, temp: TempRequirement, rnd: () => number): OrderLineSpec[] {
  const profile = PROFILE[`${brand}|${temp}`];
  if (!profile) throw new RangeError(`no order profile for ${brand} ${temp}`);
  const products = shuffled(productsFor(brand, temp), rnd).slice(0, between(rnd, ...profile.skus));
  const share = between(rnd, ...profile.kg) / products.length;
  return products
    .map((x) => ({ sku: x.sku, qty: Math.max(1, Math.round(share / Number(x.unitWeightKg))) }))
    .sort((a, b) => (a.sku < b.sku ? -1 : 1));
}

/** A placement time between 07:00 and 15:45 on the day before `deliveryDate`, before its 16:00 cutoff. */
function placedFor(deliveryDate: LocalDate, rnd: () => number): string {
  const minute = between(rnd, 7 * 60, 15 * 60 + 45);
  const hhmm = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return colomboIso(addDays(deliveryDate, -1), hhmm);
}

/** `count` order IDs from ORD10400 up, skipping the story's reserved IDs. */
export function bulkOrderIds(count: number, reserved: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let n = 10400; out.length < count; n++) {
    const id = `ORD${n}`;
    if (!reserved.has(id)) out.push(id);
  }
  return out;
}

/**
 * The bulk orders for the story delivery date at Peliyagoda. Dilini's outlet is left out: Dilini places that outlet's
 * dry and chilled orders live in walkthrough step 1.
 */
export function generatePeakDay(ref: ReferenceData, reservedIds: ReadonlySet<string>): OrderSpec[] {
  const rnd = prng(PEAK_DAY_SEED);
  const outlets = [...ref.outlets.values()]
    .filter((o) => o.depot === PEAK_DAY_DEPOT && o.id !== PEAK_STORE_OUTLET_ID)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const ofBrand = (brand: Brand) => outlets.filter((o) => o.brand === brand);

  const kinds: { outlet: Outlet; temp: TempRequirement }[] = [
    ...shuffled(ofBrand("Fresh"), rnd)
      .slice(0, PEAK_DAY_MIX.freshDry)
      .map((outlet) => ({ outlet, temp: "ambient" as const })),
    ...shuffled(ofBrand("Fresh"), rnd)
      .slice(0, PEAK_DAY_MIX.freshChilled)
      .map((outlet) => ({ outlet, temp: "chilled" as const })),
    ...shuffled(ofBrand("Style"), rnd)
      .slice(0, PEAK_DAY_MIX.style)
      .map((outlet) => ({ outlet, temp: "ambient" as const })),
    ...shuffled(ofBrand("Tech"), rnd)
      .slice(0, PEAK_DAY_MIX.tech)
      .map((outlet) => ({ outlet, temp: "ambient" as const })),
  ];
  // Orders are numbered in outlet order, as if keyed in through the day.
  kinds.sort((a, b) => (a.outlet.id < b.outlet.id ? -1 : a.outlet.id > b.outlet.id ? 1 : a.temp < b.temp ? -1 : 1));

  const ids = bulkOrderIds(kinds.length, reservedIds);
  return kinds.map(({ outlet, temp }, i) => {
    const lines = linesFor(outlet.brand, temp, rnd);
    const carried = rnd() < DEFERRED_SHARE;
    const twice = carried && rnd() < TWICE_SHARE;
    return carriedOrder(ids[i] as string, outlet, temp, lines, carried ? (twice ? 2 : 1) : 0, rnd, ref.calendar);
  });
}

/** An order for the story date, carried over through `deferrals` earlier runs (0, 1 or 2). */
function carriedOrder(
  displayId: string,
  outlet: Outlet,
  temp: TempRequirement,
  lines: OrderLineSpec[],
  deferrals: number,
  rnd: () => number,
  calendar: Calendar,
): OrderSpec {
  const reason = temp === "chilled" ? "REEFER_SHORTAGE" : outlet.brand === "Fresh" ? "CAPACITY_VOLUME" : "TIME_BUDGET";
  // Tue 29 Sep's previous operating day is Mon 28, and Mon 28's is Sat 26 (Sunday does not operate).
  const days: LocalDate[] = [STORY_DATE, "2026-09-28", "2026-09-26"].slice(0, deferrals + 1).reverse();
  const requestedDate = days[0] as LocalDate;
  return {
    displayId,
    outletId: outlet.id,
    brand: outlet.brand,
    temp,
    lines,
    requestedDate,
    deliveryDate: STORY_DATE,
    placedAt: placedFor(requestedDate, rnd),
    deferrals: days
      .slice(1)
      .map((toDate, i) =>
        deferral(requestedDate, days[i] as LocalDate, toDate, `21:${between(rnd, 10, 50)}`, reason, i + 1, calendar),
      ),
  };
}
