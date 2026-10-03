import { describe, expect, it } from "vitest";
import { can, type Actor, type Resource } from "./index";

const OUTLET_A = "018f0000-0000-7000-8000-00000000000a";
const OUTLET_B = "018f0000-0000-7000-8000-00000000000b";
const VEHICLE_A = "018f0000-0000-7000-8000-0000000000a1";
const VEHICLE_B = "018f0000-0000-7000-8000-0000000000b1";
const base = { userId: "u", sessionId: "s" };

const store: Actor = { ...base, role: "STORE", outletId: OUTLET_A, depot: "Peliyagoda" };
const dispatcher: Actor = { ...base, role: "DISPATCHER", depots: ["Peliyagoda", "Kandy"] };
const peliyagodaDispatcher: Actor = { ...base, role: "DISPATCHER", depots: ["Peliyagoda"] };
const loader: Actor = { ...base, role: "LOADER", depot: "Peliyagoda", deviceId: null };
const driver: Actor = { ...base, role: "DRIVER", vehicleId: VEHICLE_A, depot: "Kandy", deviceId: null };

const order = (outletId: string, depot: string, vehicleIds: string[] = []): Resource => ({
  kind: "order",
  outletId,
  depot,
  vehicleIds,
});
const trip = (vehicleId: string, depot: string, outletIds: string[] = []): Resource => ({
  kind: "trip",
  vehicleId,
  depot,
  outletIds,
});

describe("can(): deny by default", () => {
  it("refuses a missing actor, an unknown action and public actions", () => {
    expect(can(null, "me", { kind: "self" })).toBe(false);
    expect(can(store, "nope" as never, { kind: "self" })).toBe(false);
    expect(can(store, "toString" as never, { kind: "self" })).toBe(false);
    expect(can(store, "login", { kind: "self" })).toBe(false);
  });

  it("applies the contracts route table as the role ceiling", () => {
    expect(can(store, "me", { kind: "self" })).toBe(true);
    expect(can(store, "dispatchDay", { kind: "depot", depot: "Peliyagoda" })).toBe(false);
    expect(can(dispatcher, "storeOrders", { kind: "collection" })).toBe(false);
    expect(can(driver, "createOrder", { kind: "collection" })).toBe(false);
    expect(can(store, "reauth", { kind: "self" })).toBe(false);
    expect(can(loader, "reauth", { kind: "self" })).toBe(true);
    expect(can(dispatcher, "snapshot", { kind: "collection" })).toBe(false);
  });

  it("refuses an unrecognised resource kind", () => {
    expect(can(dispatcher, "dispatchDay", { kind: "other" } as unknown as Resource)).toBe(false);
  });
});

describe("can(): ownership", () => {
  it("store: own outlet only", () => {
    expect(can(store, "storeOrder", order(OUTLET_A, "Peliyagoda"))).toBe(true);
    expect(can(store, "storeOrder", order(OUTLET_B, "Peliyagoda"))).toBe(false);
    expect(can(store, "outlets", { kind: "outlet", outletId: OUTLET_A, depot: "Peliyagoda" })).toBe(true);
    expect(can(store, "outlets", { kind: "outlet", outletId: OUTLET_B, depot: "Peliyagoda" })).toBe(false);
    expect(can(store, "storeDeliveries", trip(VEHICLE_A, "Peliyagoda", [OUTLET_A]))).toBe(true);
    expect(can(store, "storeDeliveries", trip(VEHICLE_A, "Peliyagoda", [OUTLET_B]))).toBe(false);
    // A store's depot is not a store scope.
    expect(can(store, "outlets", { kind: "depot", depot: "Peliyagoda" })).toBe(false);
    expect(can(store, "vehicles", { kind: "vehicle", vehicleId: VEHICLE_A, depot: "Peliyagoda" })).toBe(false);
  });

  it("dispatcher: own depots", () => {
    expect(can(dispatcher, "dispatchDay", { kind: "depot", depot: "Kandy" })).toBe(true);
    expect(can(peliyagodaDispatcher, "dispatchDay", { kind: "depot", depot: "Kandy" })).toBe(false);
    expect(can(peliyagodaDispatcher, "outletHistory", { kind: "outlet", outletId: OUTLET_B, depot: "Kandy" })).toBe(
      false,
    );
    expect(
      can(peliyagodaDispatcher, "outletHistory", { kind: "outlet", outletId: OUTLET_A, depot: "Peliyagoda" }),
    ).toBe(true);
    expect(can(peliyagodaDispatcher, "vehicles", { kind: "vehicle", vehicleId: VEHICLE_B, depot: "Kandy" })).toBe(
      false,
    );
  });

  it("loader: own depot", () => {
    expect(can(loader, "snapshot", { kind: "depot", depot: "Peliyagoda" })).toBe(true);
    expect(can(loader, "snapshot", { kind: "depot", depot: "Kandy" })).toBe(false);
    expect(can(loader, "syncEvents", order(OUTLET_A, "Peliyagoda"))).toBe(true);
    expect(can(loader, "syncEvents", order(OUTLET_A, "Kandy"))).toBe(false);
    expect(can(loader, "syncEvents", trip(VEHICLE_B, "Kandy"))).toBe(false);
  });

  it("driver: own vehicle's trips", () => {
    expect(can(driver, "syncEvents", trip(VEHICLE_A, "Kandy"))).toBe(true);
    expect(can(driver, "syncEvents", trip(VEHICLE_B, "Kandy"))).toBe(false);
    expect(can(driver, "syncEvents", order(OUTLET_A, "Kandy", [VEHICLE_A]))).toBe(true);
    expect(can(driver, "syncEvents", order(OUTLET_A, "Kandy", [VEHICLE_B]))).toBe(false);
    expect(can(driver, "vehicles", { kind: "vehicle", vehicleId: VEHICLE_A, depot: "Kandy" })).toBe(true);
    // Sharing a depot does not widen a driver's scope.
    expect(can(driver, "snapshot", { kind: "depot", depot: "Kandy" })).toBe(false);
    expect(can(driver, "outlets", { kind: "outlet", outletId: OUTLET_A, depot: "Kandy" })).toBe(false);
  });
});

describe("can(): blobs", () => {
  const blob = (fields: Partial<{ depot: string; outletId: string; uploaderUserId: string }>): Resource => ({
    kind: "blob",
    depot: fields.depot ?? null,
    outletId: fields.outletId ?? null,
    uploaderUserId: fields.uploaderUserId ?? null,
  });
  it("serves the depot's dispatcher, the outlet's store and the uploading user only", () => {
    const pod = blob({ depot: "Peliyagoda", outletId: OUTLET_A, uploaderUserId: "driver-user" });
    expect(can(dispatcher, "blob", pod)).toBe(true);
    expect(can({ ...base, role: "DISPATCHER", depots: ["Kandy"] }, "blob", pod)).toBe(false);
    expect(can(store, "blob", pod)).toBe(true);
    expect(can({ ...store, outletId: OUTLET_B }, "blob", pod)).toBe(false);
    expect(can({ ...driver, userId: "driver-user" }, "blob", pod)).toBe(true);
    expect(can(driver, "blob", pod)).toBe(false);
    expect(can(loader, "blob", pod)).toBe(false);
  });

  it("serves nobody an unlinked blob", () => {
    expect(can(dispatcher, "blob", blob({}))).toBe(false);
    expect(can(store, "blob", blob({}))).toBe(false);
  });
});
