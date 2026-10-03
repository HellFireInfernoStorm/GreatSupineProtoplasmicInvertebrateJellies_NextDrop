import { describe, expect, it } from "vitest";
import { scoped, type Actor } from "./index";

const base = { userId: "u", sessionId: "s" };

describe("scoped()", () => {
  it("store: own outlet", () => {
    const scope = scoped({ ...base, role: "STORE", outletId: "o1", depot: "Peliyagoda" });
    expect(scope.orders).toEqual({ outletId: "o1" });
    expect(scope.outlets).toEqual({ id: "o1" });
    expect(scope.trips).toEqual({ stops: { some: { order: { outletId: "o1" } } } });
    expect(scope.vehicles).toEqual({ trip_vehicleId: { some: { stops: { some: { order: { outletId: "o1" } } } } } });
  });

  it("dispatcher: own depots", () => {
    const depots: Actor = { ...base, role: "DISPATCHER", depots: ["Kandy", "Peliyagoda"] };
    const scope = scoped(depots);
    expect(scope.orders).toEqual({ outlet: { depot: { in: ["Kandy", "Peliyagoda"] } } });
    expect(scope.trips).toEqual({ planningDay: { depot: { in: ["Kandy", "Peliyagoda"] } } });
    expect(scope.outlets).toEqual({ depot: { in: ["Kandy", "Peliyagoda"] } });
    expect(scope.vehicles).toEqual({ depot: { in: ["Kandy", "Peliyagoda"] } });
  });

  it("loader: own depot", () => {
    const scope = scoped({ ...base, role: "LOADER", depot: "Kandy", deviceId: null });
    expect(scope.orders).toEqual({ outlet: { depot: "Kandy" } });
    expect(scope.trips).toEqual({ planningDay: { depot: "Kandy" } });
    expect(scope.outlets).toEqual({ depot: "Kandy" });
    expect(scope.vehicles).toEqual({ depot: "Kandy" });
  });

  it("driver: own vehicle's trips", () => {
    const scope = scoped({ ...base, role: "DRIVER", vehicleId: "v1", depot: "Kandy", deviceId: null });
    const onOwnTrip = { tripStop_orderId: { some: { trip: { vehicleId: "v1" } } } };
    expect(scope.orders).toEqual(onOwnTrip);
    expect(scope.trips).toEqual({ vehicleId: "v1" });
    expect(scope.outlets).toEqual({ order_outletId: { some: onOwnTrip } });
    expect(scope.vehicles).toEqual({ id: "v1" });
  });
});

describe("scoped() feed audience and notifications", () => {
  const unscoped = { depot: null, vehicleId: null, outletId: null };
  it("matches each role's scope column or an unscoped row, for listed roles only", () => {
    expect(scoped({ ...base, role: "STORE", outletId: "o1", depot: "P" }).changeFeed).toEqual({
      roles: { has: "STORE" },
      OR: [{ outletId: "o1" }, unscoped],
    });
    expect(scoped({ ...base, role: "DISPATCHER", depots: ["K", "P"] }).changeFeed).toEqual({
      roles: { has: "DISPATCHER" },
      OR: [{ depot: { in: ["K", "P"] } }, unscoped],
    });
    expect(scoped({ ...base, role: "LOADER", depot: "K", deviceId: null }).changeFeed).toEqual({
      roles: { has: "LOADER" },
      OR: [{ depot: "K" }, unscoped],
    });
    expect(scoped({ ...base, role: "DRIVER", vehicleId: "v1", depot: "K", deviceId: null }).changeFeed).toEqual({
      roles: { has: "DRIVER" },
      OR: [{ vehicleId: "v1" }, unscoped],
    });
  });

  it("limits notifications to the user's own rows", () => {
    expect(scoped({ ...base, role: "LOADER", depot: "K", deviceId: null }).notifications).toEqual({ userId: "u" });
  });
});
