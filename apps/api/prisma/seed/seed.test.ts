import { parseEventEnvelope } from "@nextdrop/contracts";
import {
  cutoffAt,
  daysBetween,
  isOperatingDay,
  orderingGuidance,
  proposePlan,
  reduceOrder,
  validateTrip,
  type AllocationOrder,
  type OrderEvent,
} from "@nextdrop/rules";
import { describe, expect, it } from "vitest";
import { ACCOUNTS, DEMO_PASSWORD, DEMO_PIN, DISPATCHER_LOGIN_ID, driverNameFor } from "./accounts";
import { PRODUCTS, productBySku } from "./catalogue";
import { generateServiceState, generateWeeklyHistory, HISTORY_WEEKS } from "./history";
import { seedOrderSpecs } from "./index";
import { eventsOf, quantitiesOf, statusOf, type OrderSpec } from "./orders";
import { bulkOrderIds, generatePeakDay, PEAK_DAY_ORDER_COUNT, PEAK_DAY_WORKSHOP } from "./peak-day";
import { loadReference } from "./pick-fixtures";
import { HILL_RUN_WORKSHOP, STORY_CHILLED_ORDER_ID, STORY_DRY_ORDER_ID, storyOrderIds, storyOrders } from "./story";
import {
  HILL_RUN_DEPOT,
  HILL_STORE_OUTLET_ID,
  PEAK_DAY_DEPOT,
  PEAK_STORE_OUTLET_ID,
  STORY_DATE,
  WALKTHROUGH_DRIVER_ID,
  WALKTHROUGH_TRIP,
  WALKTHROUGH_VEHICLE_ID,
} from "./story-fixtures";
import { changedFields, sameValue, syncRows } from "./sync";

const ref = loadReference();
const specs = seedOrderSpecs();
const outletOf = (o: OrderSpec) => ref.outlets.get(o.outletId)!;
const peak = specs.filter((o) => outletOf(o).depot === PEAK_DAY_DEPOT);
const kandy = specs.filter((o) => outletOf(o).depot === "Kandy");
const states = new Map(generateServiceState(ref, specs).map((s) => [s.outletId, s]));

function allocationOrder(o: OrderSpec): AllocationOrder {
  const state = states.get(o.outletId)!;
  return {
    id: o.displayId,
    outletId: o.outletId,
    temp: o.temp,
    ...quantitiesOf(o),
    deliveryDate: o.deliveryDate,
    status: statusOf(o),
    brand: o.brand,
    requestedDate: o.requestedDate,
    deferredCount: o.deferrals.length,
    deferredYesterday: state.deferredLastRun,
    daysSinceLastServed: daysBetween(state.lastServedDate, STORY_DATE),
  };
}

describe("seeded orders", () => {
  it("are the same on every run", () => {
    expect(seedOrderSpecs()).toEqual(specs);
  });

  it("have unique IDs, with the bulk numbered around the story's reserved IDs", () => {
    expect(new Set(specs.map((o) => o.displayId)).size).toBe(specs.length);
    expect(bulkOrderIds(3, new Set(["ORD10401"]))).toEqual(["ORD10400", "ORD10402", "ORD10403"]);
    expect(peak.map((o) => o.displayId)).not.toContain(STORY_CHILLED_ORDER_ID);
  });

  it("all target the story date, sized from their lines", () => {
    for (const o of specs) {
      expect(o.deliveryDate).toBe(STORY_DATE);
      expect(quantitiesOf(o).weightG).toBeGreaterThan(0);
      for (const line of o.lines)
        expect(productBySku(line.sku)).toMatchObject({ brand: o.brand, tempRequirement: o.temp });
      expect(new Set(o.lines.map((l) => l.sku)).size).toBe(o.lines.length);
    }
  });

  it("are placed before their cutoff, and deferred after it, in time order", () => {
    for (const o of specs) {
      const placed = Date.parse(o.placedAt);
      expect(placed).toBeLessThan(cutoffAt(o.requestedDate));
      let last = placed;
      for (const d of o.deferrals) {
        expect(Date.parse(d.at)).toBeGreaterThan(last);
        last = Date.parse(d.at);
      }
      expect(o.deferrals.at(-1)?.toDate ?? STORY_DATE).toBe(STORY_DATE);
    }
  });

  it("build a timeline the contracts accept and the reducer agrees with", () => {
    for (const o of specs) {
      const events = eventsOf(
        o,
        o.lines.map((_, i) => `line-${i}`),
      );
      const ids = events.map((_, i) => `0190a000-0000-7000-8000-${String(i).padStart(12, "0")}`);
      for (const [i, e] of events.entries()) {
        parseEventEnvelope({
          id: ids[i],
          schemaVersion: 1,
          subject: { orderId: "0190a000-0000-7000-8000-000000000999" },
          source: "SERVER",
          actor: { userId: "0190a000-0000-7000-8000-000000000998", role: e.actor.role },
          capturedAt: e.at,
          receivedAt: e.at,
          disposition: "APPLIED",
          type: e.type,
          payload: e.payload,
        });
      }
      const reduced = reduceOrder(
        o.displayId,
        events.map((e, i) => ({ id: ids[i], type: e.type, subject: {}, payload: e.payload }) as OrderEvent),
      );
      expect(reduced.status).toBe(statusOf(o));
    }
  });
});

describe("the Peliyagoda peak day", () => {
  it("has about 86 orders, Fresh-heavy, without Dilini's outlet (Dilini orders live)", () => {
    expect(peak).toHaveLength(PEAK_DAY_ORDER_COUNT);
    expect(PEAK_DAY_ORDER_COUNT).toBe(86);
    expect(peak.filter((o) => o.brand === "Fresh").length / peak.length).toBeGreaterThan(0.7);
    expect(peak.map((o) => o.outletId)).not.toContain(PEAK_STORE_OUTLET_ID);
  });

  it("exceeds capacity with the workshop vehicles out", () => {
    const workshop = PEAK_DAY_WORKSHOP.map((w) => w.vehicleId);
    for (const id of workshop) expect(ref.vehicles.get(id)?.depot).toBe(PEAK_DAY_DEPOT);
    const result = proposePlan(
      {
        date: STORY_DATE,
        depot: PEAK_DAY_DEPOT,
        orders: peak.map(allocationOrder),
        unavailableVehicleIds: new Set(workshop),
        breakdownVehicleIds: new Set(PEAK_DAY_WORKSHOP.filter((w) => w.reason === "BREAKDOWN").map((w) => w.vehicleId)),
      },
      ref,
    );
    expect(result.stats.deferred).toBeGreaterThanOrEqual(3);
    expect(result.stats.served).toBeGreaterThan(peak.length * 0.9);
    expect(new Set(result.deferrals.map((d) => d.reasonCode)).size).toBeGreaterThan(1);
  });

  it("puts reefers, vans and a breakdown in the workshop", () => {
    const vehicles = PEAK_DAY_WORKSHOP.map((w) => ref.vehicles.get(w.vehicleId)!);
    expect(vehicles.some((v) => v.temp === "reefer" && v.type === "truck")).toBe(true);
    expect(vehicles.some((v) => v.type === "van")).toBe(true);
    expect(PEAK_DAY_WORKSHOP.filter((w) => w.reason === "BREAKDOWN")).toHaveLength(1);
  });

  it("includes outlets with both a dry and a chilled order, van-only and mall outlets", () => {
    const fresh = peak.filter((o) => o.brand === "Fresh");
    const dry = new Set(fresh.filter((o) => o.temp === "ambient").map((o) => o.outletId));
    const both = fresh.filter((o) => o.temp === "chilled" && dry.has(o.outletId));
    expect(both.length).toBeGreaterThanOrEqual(5);
    expect(peak.some((o) => outletOf(o).parking === "van_only")).toBe(true);
    expect(peak.some((o) => outletOf(o).parking === "mall_dock")).toBe(true);
  });

  it("carries some orders over from yesterday's run, a few of them twice", () => {
    const once = peak.filter((o) => o.deferrals.length === 1);
    const twice = peak.filter((o) => o.deferrals.length === 2);
    expect(once.length).toBeGreaterThanOrEqual(4);
    expect(twice.length).toBeGreaterThanOrEqual(1);
    for (const o of [...once, ...twice]) {
      expect(statusOf(o)).toBe("DEFERRED");
      expect(states.get(o.outletId)?.deferredLastRun).toBe(true);
    }
  });
});

describe("brand ordering guidance (ADR 0010)", () => {
  it("is followed: operating days, one order per outlet and temperature, one Style order, few large Tech items", () => {
    const perOutlet = new Map<string, OrderSpec[]>();
    for (const o of specs) {
      expect(isOperatingDay(o.deliveryDate, ref.calendar)).toBe(true);
      expect(orderingGuidance(o.brand, o.requestedDate, ref.calendar)).not.toBe("ordering.nonOperatingDay");
      perOutlet.set(o.outletId, [...(perOutlet.get(o.outletId) ?? []), o]);
    }
    for (const orders of perOutlet.values()) {
      const temps = orders.map((o) => o.temp);
      expect(new Set(temps).size).toBe(temps.length);
      if (orders[0]?.brand !== "Fresh") expect(orders).toHaveLength(1);
    }
    for (const o of specs.filter((x) => x.brand === "Tech")) expect(o.lines.length).toBeLessThanOrEqual(2);
  });
});

describe("the Kandy story orders", () => {
  const story = storyOrders(ref.calendar);

  it("are a handful of Kandy orders, separate from the bulk", () => {
    expect(kandy.map((o) => o.displayId).sort()).toEqual(story.map((o) => o.displayId).sort());
    expect(story.length).toBeGreaterThanOrEqual(5);
    const bulk = generatePeakDay(ref, storyOrderIds(ref.calendar)).map((o) => o.displayId);
    for (const o of story) expect(bulk).not.toContain(o.displayId);
  });

  it("fill the pinned hill trip, which still validates with the real order sizes", () => {
    const onTrip = story.filter((o) => (WALKTHROUGH_TRIP.stopOutletIds as readonly string[]).includes(o.outletId));
    expect([...new Set(onTrip.map((o) => o.outletId))].sort()).toEqual([...WALKTHROUGH_TRIP.stopOutletIds].sort());
    const trip = { ref: "T-hill", vehicleId: WALKTHROUGH_VEHICLE_ID, tripNo: 1, orders: onTrip.map(allocationOrder) };
    expect(validateTrip(trip, ref, { date: STORY_DATE }).violations).toEqual([]);
  });

  it("put the hill trip on the walkthrough vehicle when the Kandy plan is proposed (ADR 0048)", () => {
    const workshop = HILL_RUN_WORKSHOP.map((w) => w.vehicleId);
    for (const id of workshop) expect(ref.vehicles.get(id)?.depot).toBe(HILL_RUN_DEPOT);
    const result = proposePlan(
      {
        date: STORY_DATE,
        depot: HILL_RUN_DEPOT,
        orders: kandy.map(allocationOrder),
        unavailableVehicleIds: new Set(workshop),
        breakdownVehicleIds: new Set(),
      },
      ref,
    );
    expect(result.stats.deferred).toBe(0);
    const hill = result.trips.filter((t) => t.orders.some((o) => o.outletId === HILL_STORE_OUTLET_ID));
    expect(hill).toHaveLength(1);
    expect(hill[0]).toMatchObject({ vehicleId: WALKTHROUGH_VEHICLE_ID, tripNo: WALKTHROUGH_TRIP.tripNo });
    expect([...new Set(hill[0]!.orders.map((o) => o.outletId))]).toEqual([...WALKTHROUGH_TRIP.stopOutletIds]);
  });

  it("give the hill store a chilled and a dry order: ORD10412 (carried over) and ORD10468", () => {
    const atStore = story.filter((o) => o.outletId === HILL_STORE_OUTLET_ID);
    expect(atStore.map((o) => [o.displayId, o.temp])).toEqual([
      [STORY_CHILLED_ORDER_ID, "chilled"],
      [STORY_DRY_ORDER_ID, "ambient"],
    ]);
    const chilled = atStore[0]!;
    expect(chilled.lines.reduce((n, l) => n + l.qty, 0)).toBe(20);
    expect(chilled.deferrals).toHaveLength(1);
    expect(atStore[1]!.lines.reduce((n, l) => n + l.qty, 0)).toBe(18);
    expect(states.get(HILL_STORE_OUTLET_ID)?.deferredLastRun).toBe(true);
  });
});

describe("accounts and drivers", () => {
  it("match §15.3: one account per role plus the extras", () => {
    const byLogin = new Map(ACCOUNTS.map((a) => [a.loginId, a]));
    expect(byLogin.get(PEAK_STORE_OUTLET_ID)).toMatchObject({ role: "STORE", displayName: "Dilini" });
    expect(byLogin.get(DISPATCHER_LOGIN_ID)).toMatchObject({ role: "DISPATCHER", displayName: "Nimal", depot: null });
    expect(byLogin.get("LDR001")).toMatchObject({ role: "LOADER", depot: "Peliyagoda" });
    expect(byLogin.get(WALKTHROUGH_DRIVER_ID)).toMatchObject({ role: "DRIVER", vehicle: WALKTHROUGH_VEHICLE_ID });
    expect(byLogin.get("DRV001")).toMatchObject({ role: "DRIVER", displayName: "Ruwan S.", vehicle: "VEH001" });
    expect(byLogin.get("LDR002")).toMatchObject({ role: "LOADER", depot: "Kandy" });
    expect(byLogin.get(HILL_STORE_OUTLET_ID)).toMatchObject({ role: "STORE", outlet: HILL_STORE_OUTLET_ID });
    expect(ACCOUNTS).toHaveLength(7);
  });

  it("use the login shapes of auth.md", () => {
    for (const a of ACCOUNTS) {
      if (a.role === "LOADER") expect(a.loginId).toMatch(/^LDR\d{3}$/);
      if (a.role === "DRIVER") expect(a.loginId).toMatch(/^DRV\d{3}$/);
      if (a.role === "STORE") expect(a.loginId).toBe(a.outlet);
      if (a.role === "DISPATCHER") expect(a.loginId).toContain("@");
      expect(a.secret).toBe(a.role === "LOADER" || a.role === "DRIVER" ? DEMO_PIN : DEMO_PASSWORD);
    }
  });

  it("name the story drivers", () => {
    expect(driverNameFor(WALKTHROUGH_VEHICLE_ID)).toBe("Sampath");
    expect(driverNameFor("VEH001")).toBe("Ruwan S.");
    expect(driverNameFor("VEH060")).toMatch(/\S/);
  });
});

describe("history", () => {
  it("has a service state for every outlet, served on an operating day before the story date", () => {
    expect(states.size).toBe(ref.outlets.size);
    for (const s of states.values()) {
      expect(isOperatingDay(s.lastServedDate, ref.calendar)).toBe(true);
      expect(daysBetween(s.lastServedDate, STORY_DATE)).toBeGreaterThan(0);
    }
  });

  it("has about 12 weeks of weekly demand per depot and brand, before the story week", () => {
    const rows = generateWeeklyHistory(ref, specs);
    expect(rows).toHaveLength(2 * 3 * HISTORY_WEEKS);
    expect(new Set(rows.map((r) => `${r.depot}|${r.brand}|${r.isoYear}|${r.isoWeek}`)).size).toBe(rows.length);
    for (const r of rows) {
      expect(r.isoYear * 100 + r.isoWeek).toBeLessThan(2026 * 100 + 40);
      expect(Number(r.chilledVolumeM3)).toBeLessThanOrEqual(Number(r.totalVolumeM3));
      if (r.brand !== "Fresh") expect(Number(r.chilledVolumeM3)).toBe(0);
      expect(Number(r.totalVolumeM3)).toBeGreaterThan(0);
    }
    expect(generateWeeklyHistory(ref, specs)).toEqual(rows);
  });
});

describe("catalogue", () => {
  it("has unique SKUs with chilled and dry Fresh goods", () => {
    expect(new Set(PRODUCTS.map((x) => x.sku)).size).toBe(PRODUCTS.length);
    expect(PRODUCTS.some((x) => x.brand === "Fresh" && x.tempRequirement === "chilled")).toBe(true);
    expect(PRODUCTS.some((x) => x.brand === "Fresh" && x.tempRequirement === "ambient")).toBe(true);
  });
});

describe("compare-and-write", () => {
  const decimal = (v: string) => ({ toString: () => v });

  it("compares stored decimals, dates and nulls with what the seed wants", () => {
    expect(sameValue(decimal("30"), "30.0")).toBe(true);
    expect(sameValue(decimal("30.5"), "30.0")).toBe(false);
    expect(sameValue(new Date("2026-09-29"), new Date("2026-09-29"))).toBe(true);
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue("x", null)).toBe(false);
    expect(changedFields({ a: 1, b: "x" }, { a: 1, b: "y" })).toEqual({ b: "y" });
    expect(changedFields({ a: 1 }, { a: 1 })).toBeNull();
  });

  it("creates what is missing, updates what differs, and writes nothing the second time", async () => {
    const table = [{ id: "1", key: "a", v: 1 }];
    const run = () =>
      syncRows({
        rows: [
          { key: "a", v: 2 },
          { key: "b", v: 3 },
        ],
        key: (r) => r.key,
        existing: async () => table,
        create: async (rows) => table.push(...rows.map((r, i) => ({ id: `new${i}`, ...r }))),
        update: async (id, data) =>
          Object.assign(
            table.find((r) => r.id === id)!,
            data,
          ),
      });
    expect(await run()).toEqual({ created: 1, updated: 1 });
    expect(await run()).toEqual({ created: 0, updated: 0 });
  });
});
