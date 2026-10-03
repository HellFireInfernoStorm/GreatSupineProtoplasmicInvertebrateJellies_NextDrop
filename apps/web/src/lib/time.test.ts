import { describe, expect, it } from "vitest";
import { formatDay, formatTime } from "./time";

describe("display formats", () => {
  it("shows 24-hour Colombo time whatever the device zone", () => {
    expect(formatTime("2026-09-29T00:42:00.000Z")).toBe("06:12");
    expect(formatTime(new Date("2026-09-29T15:40:00.000Z"))).toBe("21:10");
  });

  it("shows the Colombo day, which can differ from the UTC day", () => {
    expect(formatDay("2026-09-28T19:00:00.000Z")).toBe("Tue 29 Sep");
  });
});
