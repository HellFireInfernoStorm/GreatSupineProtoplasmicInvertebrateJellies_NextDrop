import { describe, expect, it } from "vitest";
import {
  addDays,
  calendarDay,
  colomboInstant,
  colomboLocal,
  cutoffAt,
  dayOfWeek,
  deliveryDateFor,
  isoWeekOf,
  nextOperatingDate,
  operatingDateAfter,
  operatingDaysBetween,
} from "./calendar";
import { loadReferenceData } from "./test-support/reference-csv";

const { calendar } = loadReferenceData();
const noCalendar = new Map();

describe("date arithmetic", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(() => addDays("2025-02-29", 1)).toThrow(RangeError);
  });

  it("numbers weekdays from Monday = 0, as calendar.csv does", () => {
    expect(dayOfWeek("2026-10-05")).toBe(0);
    expect(dayOfWeek("2026-10-04")).toBe(6);
    for (const row of calendar.values()) expect(dayOfWeek(row.date)).toBe(row.dow);
  });

  it("computes ISO weeks that match calendar.csv", () => {
    expect(isoWeekOf("2024-12-30")).toEqual({ isoYear: 2025, isoWeek: 1 });
    for (const row of calendar.values())
      expect(isoWeekOf(row.date)).toEqual({ isoYear: row.isoYear, isoWeek: row.isoWeek });
  });
});

describe("operating days", () => {
  it("rolls a Sunday to Monday", () => {
    expect(nextOperatingDate("2024-03-10", calendar)).toBe("2024-03-11");
    expect(operatingDateAfter("2024-03-09", calendar)).toBe("2024-03-11");
  });

  it("keeps an operating date as it is", () => {
    expect(nextOperatingDate("2024-03-09", calendar)).toBe("2024-03-09");
  });

  it("rolls from Saturday past Sunday and two non-operating holidays (Sinhala and Tamil New Year 2025)", () => {
    expect(calendarDay("2025-04-14", calendar)).toMatchObject({ isHoliday: true, isOperating: false });
    expect(operatingDateAfter("2025-04-12", calendar)).toBe("2025-04-16");
    expect(nextOperatingDate("2025-04-13", calendar)).toBe("2025-04-16");
  });

  it("rolls a non-operating Saturday holiday to Monday (New Year 2024)", () => {
    expect(nextOperatingDate("2024-04-13", calendar)).toBe("2024-04-15");
  });

  it("treats an operating holiday as operating (Vesak 2024)", () => {
    expect(calendarDay("2024-05-23", calendar)).toMatchObject({ isHoliday: true, isOperating: true });
    expect(nextOperatingDate("2024-05-23", calendar)).toBe("2024-05-23");
  });

  it("falls back to Monday to Saturday for dates after calendar.csv ends", () => {
    expect(calendar.has("2026-10-03")).toBe(false);
    expect(calendarDay("2026-10-03", calendar)).toMatchObject({
      dow: 5,
      isoYear: 2026,
      isoWeek: 40,
      isOperating: true,
    });
    expect(nextOperatingDate("2026-10-04", calendar)).toBe("2026-10-05");
    expect(operatingDateAfter("2026-10-03", noCalendar)).toBe("2026-10-05");
  });

  it("counts operating days for a slip", () => {
    expect(operatingDaysBetween("2026-10-02", "2026-10-05", noCalendar)).toBe(2);
    expect(operatingDaysBetween("2025-04-12", "2025-04-16", calendar)).toBe(1);
    expect(operatingDaysBetween("2026-10-05", "2026-10-05", noCalendar)).toBe(0);
  });
});

describe("cutoff", () => {
  it("is 16:00 Asia/Colombo (10:30 UTC) on the calendar day before delivery", () => {
    expect(new Date(cutoffAt("2026-09-29")).toISOString()).toBe("2026-09-28T10:30:00.000Z");
    expect(new Date(cutoffAt("2026-10-01", { cutoffMinute: 15 * 60 })).toISOString()).toBe("2026-09-30T09:30:00.000Z");
  });

  it("converts between UTC instants and Colombo local time", () => {
    const t = colomboInstant("2026-10-02", 23 * 60 + 45);
    expect(new Date(t).toISOString()).toBe("2026-10-02T18:15:00.000Z");
    expect(colomboLocal(t)).toEqual({ date: "2026-10-02", minute: 1425 });
    expect(colomboLocal(Date.parse("2026-10-02T19:00:00Z"))).toEqual({ date: "2026-10-03", minute: 30 });
  });

  it("keeps an order placed before the cutoff on its date", () => {
    const placed = colomboInstant("2026-09-28", 15 * 60 + 59);
    expect(deliveryDateFor("2026-09-29", placed, calendar)).toBe("2026-09-29");
  });

  it("moves an order placed at or after the cutoff to the next operating date", () => {
    const placed = colomboInstant("2026-09-28", 16 * 60);
    expect(deliveryDateFor("2026-09-29", placed, calendar)).toBe("2026-09-30");
  });

  it("moves a Friday-evening order for Saturday past Sunday to Monday", () => {
    const placed = colomboInstant("2026-10-02", 17 * 60);
    expect(deliveryDateFor("2026-10-03", placed, calendar)).toBe("2026-10-05");
  });

  it("rolls a request for a non-operating date before applying the cutoff", () => {
    const placed = colomboInstant("2025-04-11", 12 * 60);
    expect(deliveryDateFor("2025-04-13", placed, calendar)).toBe("2025-04-16");
  });

  it("never targets a date before the order was placed", () => {
    const placed = colomboInstant("2026-10-07", 9 * 60);
    expect(deliveryDateFor("2026-09-29", placed, calendar)).toBe("2026-10-08");
  });
});
