import { apiFixtures } from "@nextdrop/contracts";
import { describe, expect, it } from "vitest";
import {
  alertsOf,
  confirmable,
  expectedQty,
  heroRun,
  orderUnits,
  placeDeferred,
  runsOf,
  type Delivery,
  type Order,
} from "./model";

const line = (id: string, qtyOrdered: number, patch: Partial<Order["lines"][number]> = {}) => ({
  ...apiFixtures.order.lines[0]!,
  id,
  qtyOrdered,
  qtyLoaded: 0,
  qtyDelivered: 0,
  qtyReceived: 0,
  ...patch,
});
const order = (patch: Partial<Order>): Order => ({
  ...apiFixtures.order,
  flags: { short: [], damaged: [] },
  deferral: null,
  ...patch,
});
const delivery = (o: Order, patch: Partial<Delivery> = {}): Delivery => ({
  order: o,
  trip: { ...apiFixtures.trip, stops: [{ ...apiFixtures.trip.stops[0]!, order: o }] },
  signal: "ONLINE",
  lastHeardAt: "2026-10-03T00:18:00.000Z",
  ...patch,
});

describe("what a store should expect", () => {
  it("takes the dock's shortfall off an order that is not loaded yet", () => {
    const o = order({
      status: "PLANNED",
      lines: [line("a", 12), line("b", 8)],
      flags: { short: [{ lineId: "a", qtyShort: 4, resolution: "SHIP_PARTIAL" }], damaged: [] },
    });
    expect(expectedQty(o, o.lines[0]!)).toBe(8);
    expect(orderUnits(o)).toEqual({ ordered: 20, expected: 16, short: 4 });
  });
  it("uses the loader's count once loaded and the driver's count once delivered", () => {
    const loaded = order({ status: "OUT_FOR_DELIVERY", lines: [line("a", 12, { qtyLoaded: 9 })] });
    expect(orderUnits(loaded).expected).toBe(9);
    const delivered = order({ status: "DELIVERED", lines: [line("a", 12, { qtyLoaded: 9, qtyDelivered: 7 })] });
    expect(orderUnits(delivered).expected).toBe(7);
  });
});

describe("the run on the hero card", () => {
  const chilled = order({ id: "018f1234-5678-7890-abcd-ef1234567001", status: "OUT_FOR_DELIVERY" });
  const dry = order({ id: "018f1234-5678-7890-abcd-ef1234567002", status: "OUT_FOR_DELIVERY" });

  it("groups the orders of one trip into one run", () => {
    const runs = runsOf([delivery(chilled), delivery(dry)]);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.orders).toHaveLength(2);
    expect(runs[0]!.state).toBe("onway");
  });
  it("leaves out an order with no trip", () => {
    const waiting = order({ status: "ORDERED", assignment: null });
    expect(runsOf([delivery(waiting, { trip: null })])).toEqual([]);
    expect(heroRun([])).toBeNull();
  });
  it("is only as far along as its slowest order", () => {
    const run = runsOf([delivery({ ...chilled, status: "LOADED" }), delivery(dry)])[0]!;
    expect(run.status).toBe("LOADED");
    expect(run.state).toBe("planned");
  });
  it("shows a silent driver as no signal, not as late", () => {
    const run = runsOf([delivery(chilled, { signal: "NO_SIGNAL" })])[0]!;
    expect(run.state).toBe("nosignal");
    expect(confirmable(run)).toBeNull();
  });
  it("opens the receipt once the driver's record has arrived, and keeps both times", () => {
    const done = { ...chilled, status: "DELIVERED" as const };
    const stop = {
      ...apiFixtures.trip.stops[0]!,
      order: done,
      deliveredAt: "2026-10-03T00:42:00.000Z",
      confirmedAt: "2026-10-03T02:10:00.000Z",
    };
    const run = runsOf([delivery(done, { trip: { ...apiFixtures.trip, stops: [stop] }, signal: "NO_SIGNAL" })])[0]!;
    // The record is here, so the earlier silence no longer matters.
    expect(run.state).toBe("delivered");
    expect(confirmable(run)?.id).toBe(done.id);
    expect(run.deliveredAt).toBe("2026-10-03T00:42:00.000Z");
    expect(run.confirmedAt).toBe("2026-10-03T02:10:00.000Z");
  });
  it("is closed once every order is received or disputed", () => {
    const runs = runsOf([delivery({ ...chilled, status: "DISPUTED" }), delivery({ ...dry, status: "RECEIVED" })]);
    expect(runs[0]!.state).toBe("closed");
    expect(heroRun(runs)).toBe(runs[0]);
  });
});

describe("alerts", () => {
  const short = order({
    status: "LOADED",
    lines: [line("a", 12, { qtyLoaded: 8 })],
    flags: { short: [{ lineId: "a", qtyShort: 4, resolution: "SHIP_PARTIAL" }], damaged: [] },
  });
  it("warns of a partial delivery before it arrives", () => {
    expect(alertsOf([short])).toMatchObject([{ kind: "partial", ordered: 12, expected: 8, short: 4 }]);
  });
  it("stops warning once the delivery has arrived", () => {
    expect(alertsOf([{ ...short, status: "DELIVERED" }])).toEqual([]);
  });
  it("tells the store about an order that was moved", () => {
    const moved = order({
      status: "DEFERRED",
      deferral: {
        reasonCode: "REEFER_SHORTAGE",
        causeKind: "CHOICE",
        scoreInputs: null,
        toDate: "2026-10-05",
        daysUnserved: 1,
        consecutiveDeferrals: 1,
        note: "",
        decidedBy: "DISPATCHER",
      },
    });
    expect(alertsOf([moved])).toMatchObject([{ kind: "deferred", deferral: { toDate: "2026-10-05" } }]);
  });
});

describe("where a deferred order is listed", () => {
  const id = (n: number) => `018f1234-5678-7890-abcd-ef123456700${n}`;
  const deferred = (n: number, requestedDate: string, currentDate: string) =>
    order({ id: id(n), status: "DEFERRED", requestedDate, currentDate });
  const fromTuesday = deferred(1, "2026-10-06", "2026-10-07");
  const fromThursday = deferred(2, "2026-10-08", "2026-10-09");

  it("keeps an order with the day it was requested for, and lists any other as moved", () => {
    const placed = placeDeferred([fromTuesday, fromThursday], "2026-10-06", []);
    expect(placed.withNextDay.map((o) => o.id)).toEqual([id(1)]);
    expect(placed.moved.map((o) => o.id)).toEqual([id(2)]);
  });
  it("does not list an order twice", () => {
    expect(placeDeferred([fromTuesday, fromThursday], "2026-10-06", [fromTuesday, fromThursday])).toEqual({
      withNextDay: [],
      moved: [],
    });
  });
});
