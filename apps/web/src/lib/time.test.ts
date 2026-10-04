import { describe, expect, it } from "vitest";
import { formatDay, formatDayMonth, formatDayRange, formatTime, formatWeekday, localDateInstant } from "./time";

describe("display formats", () => {
  it("localizes the weekday in the Colombo display zone", () => {
    expect(formatWeekday("2026-09-28T19:00:00.000Z")).toBe("Tuesday");
    expect(formatWeekday("2026-09-28T19:00:00.000Z", "fr")).toBe("mardi");
  });
  it("shows 24-hour Colombo time whatever the device zone", () => {
    expect(formatTime("2026-09-29T00:42:00.000Z")).toBe("06:12");
    expect(formatTime(new Date("2026-09-29T15:40:00.000Z"))).toBe("21:10");
  });

  it("shows the Colombo day, which can differ from the UTC day", () => {
    expect(formatDay("2026-09-28T19:00:00.000Z")).toBe("Tue 29 Sep");
  });

  it("shows a local date and a Mon–Sat range without the weekday", () => {
    expect(formatDayMonth(localDateInstant("2026-09-28"))).toBe("28 Sep");
    expect(formatDayRange(localDateInstant("2026-09-28"), localDateInstant("2026-10-03"))).toBe("28 Sep–3 Oct");
    expect(formatDayRange(localDateInstant("2026-10-05"), localDateInstant("2026-10-10"))).toBe("5–10 Oct");
  });
});
