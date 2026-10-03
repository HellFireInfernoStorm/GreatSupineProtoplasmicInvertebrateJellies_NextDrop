import { describe, expect, it } from "vitest";
import * as c from "./index";

describe("PR 77 protocol regressions", () => {
  const event = c.apiFixtures.clientEvent;
  const receivedAt = event.capturedAt;

  it("serializes correlated rejections for missing/malformed IDs without failing valid neighbours", () => {
    expect(c).toHaveProperty("parseClientEvent");
    const { clientEventId: _id, ...withoutId } = event;
    const body = c.syncEventsIngressRequestSchema.parse({
      deviceId: event.deviceId,
      events: [event, withoutId, { ...event, clientEventId: "bad" }, null],
    });
    const results = body.events.map((raw, index) => c.parseClientEvent(raw, body.deviceId, index, receivedAt));
    expect(results[0]).toEqual({ success: true, data: event });
    for (const [index, result] of results.entries()) {
      if (!result.success) {
        expect(c.syncEventResultSchema.parse(result.rejection)).toEqual({
          status: "REJECTED",
          clientEventId: null,
          index,
          code: "SCHEMA_INVALID",
          receivedAt,
        });
      }
    }
    expect(results.filter((result) => !result.success)).toHaveLength(3);
    const response = {
      results: results.map((result) => (result.success ? c.apiFixtures.syncEventResult : result.rejection)),
      serverTime: receivedAt,
      feedHead: "0",
    };
    expect(c.syncEventsResponseSchema.parse(JSON.parse(JSON.stringify(response)))).toEqual(response);
  });

  it("enforces batch device identity in the exported server parser", () => {
    expect(c).toHaveProperty("parseClientEvent");
    const otherDevice = "018f1234-5678-7890-abcd-ef1234567899";
    const result = c.parseClientEvent({ ...event, deviceId: otherDevice }, event.deviceId, 2, receivedAt);
    expect(result).toEqual({
      success: false,
      rejection: {
        status: "REJECTED",
        clientEventId: event.clientEventId,
        index: 2,
        code: "SCHEMA_INVALID",
        receivedAt,
      },
    });
    if (!result.success) expect(c.syncEventResultSchema.parse(result.rejection)).toEqual(result.rejection);
    expect(c.parseClientEvent({ ...event, payload: null }, event.deviceId, 0, receivedAt).success).toBe(false);
  });

  it("permits null IDs only on correlated rejected results", () => {
    const rejection = { status: "REJECTED", clientEventId: null, index: 0, code: "SCHEMA_INVALID", receivedAt };
    expect(c.syncEventResultSchema.parse(rejection)).toEqual(rejection);
    const { index: _index, ...uncorrelated } = rejection;
    expect(c.syncEventResultSchema.safeParse(uncorrelated).success).toBe(false);
    expect(c.syncEventResultSchema.safeParse({ ...rejection, index: -1 }).success).toBe(false);
    expect(c.syncEventResultSchema.safeParse({ ...c.apiFixtures.syncEventResult, clientEventId: null }).success).toBe(
      false,
    );
  });

  it("makes reauth reachable after expiry with explicit rate-limit responses", () => {
    expect(c.apiRoutes.reauth.access).toBe("expired-session");
    expect(c.apiRoutes.reauth.roles).toEqual(["LOADER", "DRIVER"]);
    expect(c.apiRoutes.reauth.responses).toHaveProperty("429", "apiError");
  });

  it("represents an untouched available fleet row without invented event history", () => {
    const row = {
      vehicle: c.apiFixtures.vehicle,
      availability: {
        status: "AVAILABLE",
        reason: null,
        note: null,
        changedAt: null,
      },
    };
    expect(c.fleetResponseSchema.parse({ date: c.apiFixtures.dateQuery.date, items: [row] }).items[0]).toEqual(row);
    expect(c.updateFleetRequestSchema.safeParse({ changes: [row.availability] }).success).toBe(false);
  });

  it("returns a cursor usable on the next history page and null on completion", () => {
    const first = c.orderHistoryResponseSchema.parse({ ...c.apiFixtures.orderHistoryResponse, nextCursor: "page-2" });
    expect(c.apiSchemas.listQuery.parse({ after: first.nextCursor, limit: 20 }).after).toBe("page-2");
    expect(c.orderHistoryResponseSchema.parse({ items: [], total: 1, nextCursor: null }).nextCursor).toBeNull();
    expect(c.orderHistoryResponseSchema.safeParse({ items: [], total: 0 }).success).toBe(false);
  });

  it("gives compression headroom and matches body/response/transport limits", () => {
    expect(c).toHaveProperty("MAX_BLOB_BYTES", 524288);
    expect(c.blobBodySchema.safeParse(new Uint8Array(207000)).success).toBe(true);
    expect(c.blobBodySchema.safeParse(new Uint8Array(524288)).success).toBe(true);
    expect(c.blobBodySchema.safeParse(new Uint8Array(524289)).success).toBe(false);
    expect(c.blobResponseSchema.safeParse({ ...c.apiFixtures.blobResponse, size: 524288 }).success).toBe(true);
    expect(c.blobResponseSchema.safeParse({ ...c.apiFixtures.blobResponse, size: 524289 }).success).toBe(false);
    expect(c.apiRoutes.uploadBlob.bodyLimit).toBe(524288);
    for (const route of Object.values(c.apiRoutes)) {
      if ("bodyLimit" in route) expect(route.responses).toHaveProperty("413", "apiError");
    }
  });

  it("rejects unknown request keys including nested fleet entries and server-owned fields", () => {
    for (const name of [
      "cancelOrderRequest",
      "receiptRequest",
      "reportIssueRequest",
      "resolveIssueRequest",
      "resolveConflictRequest",
    ] as const) {
      expect(c.apiSchemas[name].safeParse({ ...c.apiFixtures[name], reson: "typo" }).success).toBe(false);
    }
    expect(c.cancelOrderRequestSchema.safeParse({ reson: "dup" }).success).toBe(false);
    expect(c.receiptRequestSchema.safeParse({ lines: [] }).success).toBe(false);
    expect(
      c.receiptRequestSchema.safeParse({ lines: [{ lineId: "line-1", qtyReceived: 2, reson: "typo" }] }).success,
    ).toBe(false);
    expect(
      c.reportIssueRequestSchema.safeParse({ kind: "SHORT", lines: [{ lineId: "line-1", reson: "typo" }] }).success,
    ).toBe(false);
    const change = c.apiFixtures.updateFleetRequest.changes[0];
    for (const extra of [{ reson: "typo" }, { sourceEventId: event.clientEventId }]) {
      expect(c.updateFleetRequestSchema.safeParse({ changes: [{ ...change, ...extra }] }).success).toBe(false);
    }
    expect(
      c.vehicleAvailabilityChangedPayloadSchema.safeParse({ ...change, sourceEventId: event.clientEventId }).success,
    ).toBe(true);
  });

  it("shares human role and sync result vocabularies", () => {
    expect(c.actorSchema.shape.role.options).toEqual([...c.HUMAN_ROLES, "SYSTEM"]);
    expect(Object.keys(c.apiVariantFixtures.syncEventResult).sort()).toEqual([...c.SYNC_RESULT_STATUSES].sort());
  });
});
