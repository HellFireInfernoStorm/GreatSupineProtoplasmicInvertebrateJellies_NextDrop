import { describe, expect, it } from "vitest";
import { clockOffsetMs, observeServerTime, offsetFrom, serverNowMs } from "./clock";

describe("server clock", () => {
  it("measures the offset as server minus device", () => {
    const device = Date.parse("2026-10-03T10:00:00.000Z");
    expect(offsetFrom("2026-10-03T10:05:00.000Z", device)).toBe(5 * 60_000);
    expect(offsetFrom("2026-10-03T09:59:30.000Z", device)).toBe(-30_000);
  });

  it("ignores a server time it cannot parse", () => {
    expect(offsetFrom("not a time", 0)).toBeNull();
    observeServerTime("2026-10-03T10:05:00.000Z", Date.parse("2026-10-03T10:00:00.000Z"));
    observeServerTime("not a time", 0);
    expect(clockOffsetMs()).toBe(5 * 60_000);
  });

  it("gives server time for any device time once a response was observed", () => {
    // The demo clock can sit hours away from the device clock.
    observeServerTime("2026-10-03T16:30:00.000Z", Date.parse("2026-10-03T09:00:00.000Z"));
    expect(serverNowMs(Date.parse("2026-10-03T09:00:10.000Z"))).toBe(Date.parse("2026-10-03T16:30:10.000Z"));
  });
});
