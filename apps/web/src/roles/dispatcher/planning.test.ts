import { describe, expect, it } from "vitest";
import type { ApiDto } from "@nextdrop/contracts";
import {
  moveOrder,
  addTrip,
  emptyDraft,
  toPlan,
  makeReference,
  evaluate,
  validationContext,
  lockedDraftChange,
} from "./planning";
import { apiFixtures } from "@nextdrop/contracts";
import { sequenceStops } from "@nextdrop/rules";

const a = "01930b7e-0000-7000-8000-000000000001";
const b = "01930b7e-0000-7000-8000-000000000002";
const vehicle = "01930b7e-0000-7000-8000-000000000003";
const draft: ApiDto<"draftData"> = {
  trips: [{ ref: "T001", vehicleId: vehicle, tripNo: 1, orderIds: [a] }],
  unassignedOrderIds: [b],
  deferrals: [{ orderId: b, reasonCode: "OTHER", note: "Keep this" }],
};
describe("dispatcher draft edits", () => {
  it("assigns a whole order once and clears only its deferral", () => {
    const result = moveOrder(draft, b, "T001");
    expect(result.trips[0]?.orderIds).toEqual([a, b]);
    expect(result.unassignedOrderIds).toEqual([]);
    expect(result.deferrals).toEqual([]);
    expect(draft.trips[0]?.orderIds).toEqual([a]);
    expect(moveOrder(result, b, "T001")).toEqual(result);
  });
  it("unassigns without erasing another order's reason or merging outlet orders", () => {
    const result = moveOrder(draft, a, null);
    expect(result.unassignedOrderIds).toEqual([b, a]);
    expect(result.trips[0]?.orderIds).toEqual([]);
    expect(result.deferrals).toEqual(draft.deferrals);
  });
  it("rejects unknown orders and destinations", () => {
    expect(() => moveOrder(draft, "missing", null)).toThrow();
    expect(() => moveOrder(draft, b, "missing")).toThrow();
  });
  it("adds a unique vehicle slot and preserves untouched data", () => {
    const result = addTrip(draft, { ref: "T002", vehicleId: vehicle, tripNo: 2, orderIds: [b] });
    expect(result.trips[1]?.orderIds).toEqual([b]);
    expect(result.trips[0]).toEqual(draft.trips[0]);
    expect(result.unassignedOrderIds).toEqual([]);
    expect(() => addTrip(result, { ref: "T003", vehicleId: vehicle, tripNo: 2, orderIds: [] })).toThrow();
  });
  it("starts an empty draft with every queue order unassigned", () => {
    expect(emptyDraft([a, b])).toEqual({ trips: [], unassignedOrderIds: [a, b], deferrals: [] });
  });
});

describe("rules adapter", () => {
  it("sequences an appended earlier-window order before departure and preserves departed draft order", () => {
    const outlets = [
      {
        ...apiFixtures.outlet,
        id: a,
        displayId: "OUT110",
        district: "Badulla",
        depot: "Kandy",
        dockType: "rear_dock" as const,
        parking: "normal" as const,
        window: { open: 180, close: 480 },
      },
      {
        ...apiFixtures.outlet,
        id: b,
        displayId: "OUT111",
        district: "Badulla",
        depot: "Kandy",
        dockType: "rear_dock" as const,
        parking: "normal" as const,
        window: { open: 180, close: 480 },
      },
      {
        ...apiFixtures.outlet,
        id: vehicle,
        displayId: "OUT112",
        district: "Badulla",
        depot: "Kandy",
        dockType: "rear_dock" as const,
        parking: "normal" as const,
        window: { open: 240, close: 465 },
      },
    ];
    const truck = {
      ...apiFixtures.vehicle,
      displayId: "VEH039",
      depot: "Kandy",
      type: "truck" as const,
      temp: "reefer" as const,
    };
    const orders = outlets.map((outlet, index) => ({
      ...apiFixtures.order,
      id: outlet.id,
      outletId: outlet.id,
      status: "PLANNED" as const,
      displayId: `ORD160${index}`,
    }));
    const reference = makeReference(outlets, [truck], [apiFixtures.calendarDay]);
    const data = moveOrder(
      {
        trips: [{ ref: "T160", vehicleId: truck.id, tripNo: 1 as const, orderIds: [a, b] }],
        unassignedOrderIds: [vehicle],
        deferrals: [],
      },
      vehicle,
      "T160",
    );
    const result = evaluate(data, orders, orders[0]!.currentDate, reference, new Set());
    expect(result.violations.filter((v) => v.code === "WINDOW_MISSED")).toEqual([]);
    expect(sequenceStops(result.plan.trips[0]!, reference.ref).map((o) => o.id)).toEqual([vehicle, a, b]);
    const loadedContext = {
      publishedStops: [vehicle, a, b].map((orderId, index) => ({
        orderId,
        vehicleId: "VEH039",
        tripNo: 1,
        seq: index + 1,
        locked: true,
        departed: false,
      })),
    };
    const loaded = evaluate(
      data,
      orders.map((o) => ({ ...o, status: "LOADED" as const })),
      orders[0]!.currentDate,
      reference,
      new Set(),
      loadedContext,
    );
    expect(loaded.lockedOrderId).toBeNull();
    expect(lockedDraftChange(loaded.plan, reference, loadedContext)).toBeNull();
    expect(
      lockedDraftChange(
        toPlan(moveOrder(data, a, null), orders, orders[0]!.currentDate, reference, loadedContext),
        reference,
        loadedContext,
      ),
    ).toBe(a);
    const context = {
      publishedStops: [{ orderId: a, vehicleId: "VEH039", tripNo: 1, seq: 1, locked: false, departed: true }],
    };
    const departed = evaluate(data, orders, orders[0]!.currentDate, reference, new Set(), context);
    expect(sequenceStops(departed.plan.trips[0]!, reference.ref).map((o) => o.id)).toEqual([a, b, vehicle]);
  });
  it("uses fetched weekly fuel and loaded pins, while repeated deferrals remain warnings", () => {
    const order = { ...apiFixtures.order, status: "LOADED" as const };
    const reference = makeReference([apiFixtures.outlet], [apiFixtures.vehicle], [apiFixtures.calendarDay]);
    const context = validationContext(
      {
        vehicleFuel: [
          { vehicleId: apiFixtures.vehicle.id, usedOtherDaysThisWeekMl: apiFixtures.vehicle.weeklyFuelQuotaMl - 1 },
        ],
        outletService: [{ outletId: order.outletId, daysSinceLastServed: 7, deferredLastRun: true }],
        loadedOrders: [{ orderId: order.id, vehicleId: apiFixtures.vehicle.id, tripNo: 1, reversalRequested: false }],
      },
      reference,
    );
    const assigned = {
      ...emptyDraft([]),
      trips: [{ ref: "T001", vehicleId: apiFixtures.vehicle.id, tripNo: 2 as const, orderIds: [order.id] }],
    };
    const result = evaluate(assigned, [order], order.currentDate, reference, new Set(), context);
    expect(result.violations.some((v) => v.code === "FUEL_QUOTA_EXCEEDED")).toBe(true);
    expect(result.violations.some((v) => v.code === "ORDER_ALREADY_LOADED")).toBe(true);
    const deferred = {
      ...emptyDraft([order.id]),
      deferrals: [{ orderId: order.id, reasonCode: "TIME_BUDGET" as const }],
    };
    expect(
      evaluate(deferred, [order], order.currentDate, reference, new Set(), context).violations.some(
        (v) => v.code === "REPEAT_DEFERRAL" && v.severity === "WARN",
      ),
    ).toBe(true);
  });
  it("keeps raw integer units and separate wire order IDs", () => {
    const order = apiFixtures.order;
    const data = {
      ...emptyDraft([]),
      trips: [{ ref: "T001", vehicleId: apiFixtures.vehicle.id, tripNo: 1 as const, orderIds: [order.id] }],
    };
    const ref = makeReference([apiFixtures.outlet], [apiFixtures.vehicle], [apiFixtures.calendarDay]);
    const plan = toPlan(data, [order], order.currentDate, ref);
    expect(plan.trips[0]?.orders[0]).toMatchObject({ id: order.id, weightG: order.weightG, volumeL: order.volumeL });
    expect(plan.trips[0]?.vehicleId).toBe(apiFixtures.vehicle.displayId);
  });
  it("uses the shared validator for actual weight violations and workshop availability", () => {
    const order = { ...apiFixtures.order, weightG: apiFixtures.vehicle.weightCapG + 1000 };
    const data = {
      ...emptyDraft([]),
      trips: [{ ref: "T001", vehicleId: apiFixtures.vehicle.id, tripNo: 1 as const, orderIds: [order.id] }],
    };
    const ref = makeReference([apiFixtures.outlet], [apiFixtures.vehicle], [apiFixtures.calendarDay]);
    const result = evaluate(data, [order], order.currentDate, ref, new Set([apiFixtures.vehicle.displayId]));
    expect(result.violations.some((v) => v.code === "WEIGHT_CAP_EXCEEDED" && v.params.actual === order.weightG)).toBe(
      true,
    );
    expect(result.violations.some((v) => v.code === "VEHICLE_UNAVAILABLE")).toBe(true);
    expect(result.ok).toBe(false);
  });
});

it("keeps published UUID stop locks through the browser rules adapter", () => {
  const order = { ...apiFixtures.order, status: "OUT_FOR_DELIVERY" as const };
  const ref = makeReference([apiFixtures.outlet], [apiFixtures.vehicle], [apiFixtures.calendarDay]);
  const ctx = validationContext(
    {
      ...apiFixtures.planningContext,
      publishedStops: [
        { orderId: order.id, vehicleId: apiFixtures.vehicle.id, tripNo: 1, seq: 1, locked: true, departed: true },
      ],
    },
    ref,
  );
  const current = {
    trips: [{ ref: "T001", vehicleId: apiFixtures.vehicle.id, tripNo: 1 as const, orderIds: [order.id] }],
    unassignedOrderIds: [],
    deferrals: [],
  };
  expect(evaluate(current, [order], order.currentDate, ref, new Set(), ctx).lockedOrderId).toBeNull();
  expect(
    evaluate(moveOrder(current, order.id, null), [order], order.currentDate, ref, new Set(), ctx).lockedOrderId,
  ).toBe(order.id);
});
