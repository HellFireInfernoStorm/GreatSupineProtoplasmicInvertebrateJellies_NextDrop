import { describe, expect, it } from "vitest";
import { orderingGuidance } from "./ordering-guidance";
import { loadReferenceData } from "./test-support/reference-csv";

const { calendar } = loadReferenceData();

describe("orderingGuidance", () => {
  it("Fresh: dry and chilled are separate orders", () => {
    expect(orderingGuidance("Fresh", "2024-03-12", calendar)).toBe("ordering.fresh.separateChilled");
  });

  it("Style: weekly scheduled day away from festivals", () => {
    expect(calendar.get("2024-03-12")?.festivalRamp).toBe(0);
    expect(orderingGuidance("Style", "2024-03-12", calendar)).toBe("ordering.style.weeklyDay");
  });

  it("Style: order ahead of the peak while a festival approaches", () => {
    expect(calendar.get("2024-01-10")?.festivalRamp).toBeGreaterThan(0);
    expect(orderingGuidance("Style", "2024-01-10", calendar)).toBe("ordering.style.peakAhead");
  });

  it("Tech: single large items", () => {
    expect(orderingGuidance("Tech", "2024-03-12", calendar)).toBe("ordering.tech.singleItems");
  });

  it("any brand on a non-operating date: the order rolls to the next operating day", () => {
    for (const brand of ["Fresh", "Style", "Tech"] as const) {
      expect(orderingGuidance(brand, "2024-03-10", calendar)).toBe("ordering.nonOperatingDay");
      expect(orderingGuidance(brand, "2025-04-14", calendar)).toBe("ordering.nonOperatingDay");
    }
  });
});
