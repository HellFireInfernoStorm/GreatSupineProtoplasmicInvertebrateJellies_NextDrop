import { describe, expect, it } from "vitest";
import { apiFixtures, apiSchemas } from "./index";

describe("planning day validator context", () => {
  it("requires authoritative context instead of silently assuming empty fuel and loading history", () => {
    const { planningContext: _context, ...missing } = apiFixtures.dayResponse;
    expect(apiSchemas.dayResponse.safeParse(missing).success).toBe(false);
    expect(apiSchemas.dayResponse.safeParse(apiFixtures.dayResponse).success).toBe(true);
  });
  it("rejects fractional fuel, non-UUID identities and unknown loaded-pin fields", () => {
    const context = apiFixtures.planningContext;
    expect(
      apiSchemas.planningContext.safeParse({
        ...context,
        vehicleFuel: [{ vehicleId: "VEH001", usedOtherDaysThisWeekMl: 1 }],
      }).success,
    ).toBe(false);
    expect(
      apiSchemas.planningContext.safeParse({
        ...context,
        vehicleFuel: [{ ...context.vehicleFuel[0], usedOtherDaysThisWeekMl: 1.1 }],
      }).success,
    ).toBe(false);
    expect(
      apiSchemas.planningContext.safeParse({
        ...context,
        loadedOrders: [
          {
            orderId: apiFixtures.order.id,
            vehicleId: apiFixtures.vehicle.id,
            tripNo: 1,
            reversalRequested: false,
            trusted: true,
          },
        ],
      }).success,
    ).toBe(false);
  });
});

it("strictly validates published stop lock context", () => {
  const stop = {
    orderId: apiFixtures.order.id,
    vehicleId: apiFixtures.vehicle.id,
    tripNo: 1,
    seq: 1,
    locked: true,
    departed: true,
  };
  const context = { ...apiFixtures.planningContext, publishedStops: [stop] };
  expect(apiSchemas.planningContext.safeParse(context).success).toBe(true);
  for (const invalid of [
    { ...stop, seq: 0 },
    { ...stop, locked: "true" },
    { ...stop, trusted: true },
  ]) {
    expect(apiSchemas.planningContext.safeParse({ ...context, publishedStops: [invalid] }).success).toBe(false);
  }
});
