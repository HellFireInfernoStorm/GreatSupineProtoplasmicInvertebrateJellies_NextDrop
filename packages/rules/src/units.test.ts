import { describe, expect, it } from "vitest";
import {
  formatClock,
  intersectWindows,
  kgToGrams,
  kmPerLitreToMetresPerLitre,
  m3ToLitres,
  parseClock,
  parseWindow,
} from "./units";

describe("integer units", () => {
  it("rounds decimal inputs to exact integer thousandths", () => {
    expect(kgToGrams(5510)).toBe(5_510_000);
    expect(m3ToLitres(26.4)).toBe(26_400);
    expect(m3ToLitres(0.1 + 0.2)).toBe(300);
    expect(kmPerLitreToMetresPerLitre(4.7)).toBe(4_700);
  });

  it("rejects non-finite input", () => {
    expect(() => kgToGrams(Number.NaN)).toThrow(RangeError);
  });
});

describe("clock times", () => {
  it("parses and formats HH:MM as minutes since midnight", () => {
    expect(parseClock("03:30")).toBe(210);
    expect(parseClock("24:00")).toBe(1440);
    expect(formatClock(475)).toBe("07:55");
    expect(formatClock(parseClock("16:00"))).toBe("16:00");
  });

  it("rejects malformed clock times", () => {
    for (const bad of ["3:30", "25:00", "24:01", "07:60", "noon"]) expect(() => parseClock(bad)).toThrow(RangeError);
  });

  it("parses a mall window and intersects windows", () => {
    const mall = parseWindow("10:30-12:30");
    expect(mall).toEqual({ open: 630, close: 750 });
    expect(intersectWindows(parseWindow("09:00-17:00"), mall)).toEqual(mall);
    expect(intersectWindows(parseWindow("09:00-10:00"), mall)).toBeNull();
    expect(() => parseWindow("12:30-10:30")).toThrow(RangeError);
  });
});
