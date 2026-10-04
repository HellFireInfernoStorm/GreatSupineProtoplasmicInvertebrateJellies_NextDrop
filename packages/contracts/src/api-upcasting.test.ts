import { describe, expect, it, vi } from "vitest";

// Simulate a deploy to v3 without changing the production v2 catalogue/version.
vi.mock("./schema-version", async () => {
  const { z } = await import("zod");
  return { SCHEMA_VERSION: 3, schemaVersion: z.number().int().min(1).max(3) };
});

import { apiFixtures, parseClientEvent, syncEventResultSchema, type UpcasterRegistry } from "./index";

describe("server ingress upcasting before current-schema validation", () => {
  const event = apiFixtures.clientEvent;
  const legacy = { ...event, schemaVersion: 2, payload: { legacyLines: event.payload.lines } };
  const upgraded = { ...event, schemaVersion: 3 };

  it("upcasts legacy payloads before parsing and normalizes version without mutating input", () => {
    const transform = vi.fn(() => event.payload);
    const registry: UpcasterRegistry = new Map([[event.type, new Map([[2, transform]])]]);
    const raw = { ...legacy, payload: { legacyLines: legacy.payload.legacyLines.map((line) => ({ ...line })) } };
    expect(parseClientEvent(raw, event.deviceId, 0, event.capturedAt, registry)).toEqual({
      success: true,
      data: upgraded,
    });
    expect(transform).toHaveBeenCalledExactlyOnceWith(legacy.payload);
    expect(raw).toEqual(legacy);
  });

  it("still validates upgraded payloads and converts throwing upcasters to correlated rejections", () => {
    for (const transform of [
      () => ({ lines: "bad" }),
      () => {
        throw new Error("invalid legacy payload");
      },
    ]) {
      const registry: UpcasterRegistry = new Map([[event.type, new Map([[2, transform]])]]);
      const result = parseClientEvent(legacy, event.deviceId, 3, event.capturedAt, registry);
      expect(result.success).toBe(false);
      if (!result.success)
        expect(syncEventResultSchema.parse(result.rejection)).toEqual({
          status: "REJECTED",
          clientEventId: event.clientEventId,
          index: 3,
          code: "SCHEMA_INVALID",
          receivedAt: event.capturedAt,
        });
    }
  });

  it("rejects invalid/future version framing and server types before running upcasters", () => {
    const transform = vi.fn(() => event.payload);
    const registry: UpcasterRegistry = new Map([[event.type, new Map([[2, transform]])]]);
    for (const schemaVersion of [0, -1, 1.5, "1", 4]) {
      expect(
        parseClientEvent({ ...legacy, schemaVersion }, event.deviceId, 0, event.capturedAt, registry).success,
      ).toBe(false);
    }
    expect(
      parseClientEvent({ ...legacy, type: "ORDER_PLACED" }, event.deviceId, 0, event.capturedAt, registry).success,
    ).toBe(false);
    expect(transform).not.toHaveBeenCalled();
  });

  it("keeps current events unchanged and enforces metadata and device identity after upgrading", () => {
    const transform = vi.fn(() => event.payload);
    const registry: UpcasterRegistry = new Map([[event.type, new Map([[2, transform]])]]);
    expect(parseClientEvent(upgraded, event.deviceId, 0, event.capturedAt, registry)).toEqual({
      success: true,
      data: upgraded,
    });
    expect(transform).not.toHaveBeenCalled();
    expect(
      parseClientEvent({ ...legacy, receivedAt: event.capturedAt }, event.deviceId, 0, event.capturedAt, registry)
        .success,
    ).toBe(false);
    const mismatch = parseClientEvent(legacy, "018f1234-5678-7890-abcd-ef1234567899", 1, event.capturedAt, registry);
    expect(mismatch.success).toBe(false);
    if (!mismatch.success) expect(mismatch.rejection.code).toBe("FORBIDDEN");
  });
});
