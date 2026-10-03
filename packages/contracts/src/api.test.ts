import { describe, expect, it } from "vitest";
import * as contracts from "./index";

describe("API contracts public surface", () => {
  it("exports the schemas, route table and reusable web fixtures", () => {
    expect(contracts).toHaveProperty("apiSchemas");
    expect(contracts).toHaveProperty("apiRoutes");
    expect(contracts).toHaveProperty("apiFixtures");
    expect(contracts).toHaveProperty("apiRouteFixtures");
    expect(contracts).toHaveProperty("apiVariantFixtures");
  });

  it("retains error localization parameters and rules violation details", () => {
    expect(contracts).toHaveProperty("apiErrorSchema");
    const error = {
      code: "FORBIDDEN",
      message_key: "errors.forbidden",
      params: { scope: "outlet" },
      requestId: "request-1",
    };
    expect(contracts.apiErrorSchema.parse(error)).toEqual(error);
    const validation = {
      ok: false,
      violations: [
        {
          code: "WEIGHT_CAP_EXCEEDED",
          severity: "HARD",
          tripRef: "T015",
          vehicleId: "VEH001",
          orderIds: ["order-1"],
          params: { limit: 270, actual: 301 },
          message_key: "validator.WEIGHT_CAP_EXCEEDED",
        },
      ],
    };
    expect(contracts.validationResultSchema.parse(validation)).toEqual(validation);
    expect(contracts.validationResultSchema.safeParse({ ok: false, violations: [{}] }).success).toBe(false);
  });

  it("represents authentication and validation errors used by the route contracts", () => {
    for (const code of [
      "INVALID_CREDENTIALS",
      "UNAUTHENTICATED",
      "NOT_FOUND",
      "REVISION_CONFLICT",
      "VALIDATION_FAILED",
      "RATE_LIMITED",
      "PAYLOAD_TOO_LARGE",
      "INTERNAL_ERROR",
    ]) {
      expect(
        contracts.apiErrorSchema.safeParse({ code, message_key: `errors.${code}`, params: {}, requestId: "request-1" })
          .success,
      ).toBe(true);
    }
  });

  it("keeps feed sequences exact beyond JavaScript's safe integer range", () => {
    expect(contracts).toHaveProperty("changesResponseSchema");
    const response = {
      items: [
        {
          seq: "9007199254740993",
          kind: "order_changed",
          entity: { type: "order", id: "order-1" },
          at: "2026-10-03T05:00:00.000Z",
        },
      ],
      head: "9007199254740994",
      resetEpoch: 2,
    };
    expect(contracts.changesResponseSchema.parse(response)).toEqual(response);
    for (const head of [123, "-1", "1.2", "1e10", ""]) {
      expect(contracts.changesResponseSchema.safeParse({ ...response, head }).success).toBe(false);
    }
    expect(contracts.changesResponseSchema.safeParse({ items: [], head: "0" }).success).toBe(false);
  });

  it("requires per-event rejection and conflict details without losing timestamps", () => {
    expect(contracts).toHaveProperty("syncEventResultSchema");
    const base = { clientEventId: "018f1234-5678-7890-abcd-ef1234567890", receivedAt: "2026-10-03T05:00:00.000Z" };
    expect(contracts.syncEventResultSchema.safeParse({ ...base, status: "REJECTED" }).success).toBe(false);
    expect(
      contracts.syncEventResultSchema.parse({ ...base, status: "REJECTED", index: 0, code: "NOT_ASSIGNED" }),
    ).toEqual({
      ...base,
      status: "REJECTED",
      index: 0,
      code: "NOT_ASSIGNED",
    });
    expect(contracts.syncEventResultSchema.safeParse({ ...base, status: "HELD_CONFLICT" }).success).toBe(false);
  });

  it("accepts client field facts without server-assigned envelope fields", () => {
    expect(contracts).toHaveProperty("syncEventsRequestSchema");
    const event = {
      clientEventId: "018f1234-5678-7890-abcd-ef1234567890",
      deviceId: "018f1234-5678-7890-abcd-ef1234567891",
      deviceSeq: 0,
      schemaVersion: 1,
      subject: { orderId: "018f1234-5678-7890-abcd-ef1234567892" },
      source: "FIELD",
      actor: { userId: "loader-1", role: "LOADER" },
      capturedAt: "2026-10-03T05:00:00.000Z",
      type: "LOAD_CONFIRMED",
      payload: { lines: [{ lineId: "line-1", qtyLoaded: 0 }] },
    };
    const body = { deviceId: event.deviceId, events: [event] };
    expect(contracts.syncEventsRequestSchema.parse(body)).toEqual(body);
    expect(
      contracts.syncEventsRequestSchema.safeParse({ ...body, events: Array.from({ length: 101 }, () => event) })
        .success,
    ).toBe(false);
    expect(
      contracts.syncEventsRequestSchema.safeParse({ ...body, events: [{ ...event, deviceId: event.clientEventId }] })
        .success,
    ).toBe(false);
    expect(
      contracts.syncEventsRequestSchema.safeParse({ ...body, events: [{ ...event, type: "ORDER_PLACED" }] }).success,
    ).toBe(false);
    expect(
      contracts.syncEventsRequestSchema.safeParse({ ...body, events: [{ ...event, receivedAt: event.capturedAt }] })
        .success,
    ).toBe(false);
  });

  it("keeps a malformed neighbour available for per-event rejection during ingestion", () => {
    expect(contracts).toHaveProperty("syncEventsIngressRequestSchema");
    const body = {
      ...contracts.apiFixtures.syncEventsRequest,
      events: [
        contracts.apiFixtures.clientEvent,
        { clientEventId: contracts.apiFixtures.clientEvent.clientEventId, payload: "bad event" },
      ],
    };
    expect(contracts.syncEventsIngressRequestSchema.parse(body)).toEqual(body);
    expect(contracts.syncEventsRequestSchema.safeParse(body).success).toBe(false);
    expect(contracts.apiRoutes.syncEvents.request.body).toBe("syncEventsIngressRequest");
    expect(contracts.apiRoutes.syncEvents.clientBody).toBe("syncEventsRequest");
    expect(contracts.apiRoutes.syncEvents.bodyLimit).toBe(1000000);
  });
});
