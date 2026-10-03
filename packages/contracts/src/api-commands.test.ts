import { describe, expect, it } from "vitest";
import {
  apiFixtures,
  apiRoutes,
  apiSchemas,
  apiShortResolutionFixtures,
  apiOrderReversalFixtures,
  apiLoaderReversalFixture,
  fieldSnapshotSchema,
  orderSchema,
} from "./index";

const schemas = apiSchemas;
const pending = { to: "DEFERRED", planVersion: 2 };

describe("dispatcher short-resolution and reversal contracts", () => {
  it("exposes the exact routes and response statuses", () => {
    const routes = apiRoutes;
    for (const [name, path, params, body, response] of [
      [
        "resolveShort",
        "/api/dispatch/orders/:id/shorts/:lineId/resolve",
        "orderLineParams",
        "resolveShortRequest",
        "resolveShortResponse",
      ],
      [
        "requestReversal",
        "/api/dispatch/orders/:id/reversal",
        "idParams",
        "requestReversalRequest",
        "requestReversalResponse",
      ],
    ] as const) {
      expect(routes[name!]).toMatchObject({
        method: "POST",
        path,
        roles: ["DISPATCHER"],
        access: "session",
        transport: "json",
        request: { params, headers: "mutationHeaders", body },
        responses: { 200: response, 404: "apiError", 409: "apiError" },
      });
    }
  });

  it.each(["SHIP_PARTIAL", "HOLD_TRIP", "BACKORDER"])("accepts %s without body-owned subjects", (outcome) => {
    expect(schemas.resolveShortRequest!.parse({ outcome, note: "Mock decision" })).toEqual({
      outcome,
      note: "Mock decision",
    });
  });
  it.each(["orderId", "lineId", "planVersion", "unknown"])("rejects %s on short requests", (key) => {
    expect(
      schemas.resolveShortRequest!.safeParse({ outcome: "SHIP_PARTIAL", [key]: apiFixtures.order.id }).success,
    ).toBe(false);
  });
  it.each(["PLANNED", "DEFERRED"])("accepts reversal to %s", (to) => {
    expect(schemas.requestReversalRequest!.parse({ to })).toEqual({ to });
  });
  it.each(["orderId", "lineId", "planVersion", "unknown"])("rejects %s on reversal requests", (key) => {
    expect(schemas.requestReversalRequest!.safeParse({ to: "PLANNED", [key]: apiFixtures.order.id }).success).toBe(
      false,
    );
  });
  it("round-trips both backorder response shapes and a pending reversal", () => {
    const order = { ...apiFixtures.order, pendingReversal: null };
    for (const backorder of [null, { ...order, replacesOrderId: order.id }]) {
      const response = { order, backorder, serverTime: apiFixtures.ackResponse.serverTime };
      expect(schemas.resolveShortResponse!.parse(response)).toEqual(response);
    }
    const response = {
      order: { ...order, status: "LOADED", pendingReversal: pending },
      serverTime: apiFixtures.ackResponse.serverTime,
    };
    expect(schemas.requestReversalResponse!.parse(response)).toEqual(response);
  });
  it("exports populated short outcomes and loader reversal variants", () => {
    for (const fixture of Object.values(apiShortResolutionFixtures)) {
      expect(schemas.resolveShortResponse.parse(fixture)).toEqual(fixture);
    }
    const backorder = apiShortResolutionFixtures.BACKORDER.backorder;
    expect(backorder.replacesOrderId).toBe(apiFixtures.order.id);
    expect(backorder.id).not.toBe(apiFixtures.order.id);
    expect(backorder.lines).toHaveLength(1);
    expect(backorder.lines[0]?.qtyOrdered).toBe(1);
    expect(apiShortResolutionFixtures.SHIP_PARTIAL.backorder).toBeNull();
    expect(apiShortResolutionFixtures.HOLD_TRIP.backorder).toBeNull();
    for (const fixture of Object.values(apiOrderReversalFixtures)) expect(orderSchema.parse(fixture)).toEqual(fixture);
    expect(fieldSnapshotSchema.parse(apiLoaderReversalFixture)).toEqual(apiLoaderReversalFixture);
  });
  it("requires nullable reversal state and retains loader tasks outside the current trips", () => {
    const { pendingReversal: _pending, ...missing } = { ...apiFixtures.order, pendingReversal: null };
    expect(orderSchema.safeParse(missing).success).toBe(false);
    const loader = apiFixtures.fieldSnapshot;
    const task = { ...apiFixtures.order, status: "LOADED", pendingReversal: pending };
    const snapshot = { ...loader, scope: { ...loader.scope, trips: [], reversals: [task] } };
    expect(fieldSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(
      fieldSnapshotSchema.safeParse({
        ...loader,
        scope: { depot: loader.scope.depot, date: loader.scope.date, trips: [] },
      }).success,
    ).toBe(false);
  });
});
