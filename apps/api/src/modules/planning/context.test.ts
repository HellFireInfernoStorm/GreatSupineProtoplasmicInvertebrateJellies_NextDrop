import { expect, it } from "vitest";
import { apiFixtures as f, apiSchemas } from "@nextdrop/contracts";
import { buildReferenceData } from "@nextdrop/rules";
import { toPlanningContext, type DayInputs } from "./inputs";

it("serializes scoped authoritative fuel, service and loaded pins in integer units and UUIDs", () => {
  const other = { ...f.vehicle, id: "OTHER", depot: "Kandy" };
  const vehicle = { ...f.vehicle, id: f.vehicle.displayId };
  const inputs = {
    depot: f.vehicle.depot,
    date: f.order.currentDate,
    reference: {
      ref: buildReferenceData({
        vehicles: [vehicle, other],
        outlets: [],
        districts: [],
        serviceAllowances: [],
        calendar: [],
      }),
      ids: { vehicleUuid: new Map([[vehicle.id, f.vehicle.id]]), vehicleDisplay: new Map(), outletDisplay: new Map() },
    },
    queue: [{ id: f.order.id, outletId: f.outlet.id }],
    allocation: { orders: [{ id: f.order.id, daysSinceLastServed: 7, deferredYesterday: true }] },
    validation: {
      fuelUsedThisWeekMl: new Map([
        [vehicle.id, 190001],
        [other.id, 999999],
      ]),
      loadedOrders: new Map([[f.order.id, { vehicleId: vehicle.id, tripNo: 2, reversalRequested: true }]]),
    },
  } as unknown as DayInputs;
  const context = toPlanningContext(inputs);
  expect(apiSchemas.planningContext.safeParse(context).success).toBe(true);
  expect(context.vehicleFuel).toEqual([{ vehicleId: f.vehicle.id, usedOtherDaysThisWeekMl: 190001 }]);
  expect(context.outletService).toEqual([{ outletId: f.outlet.id, daysSinceLastServed: 7, deferredLastRun: true }]);
  expect(context.loadedOrders).toEqual([
    { orderId: f.order.id, vehicleId: f.vehicle.id, tripNo: 2, reversalRequested: true },
  ]);
  inputs.validation = { date: inputs.date };
  expect(toPlanningContext(inputs).vehicleFuel[0]?.usedOtherDaysThisWeekMl).toBe(0);
});
