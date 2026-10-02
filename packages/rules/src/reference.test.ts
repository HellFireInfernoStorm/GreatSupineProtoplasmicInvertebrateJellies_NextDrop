import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { serviceAllowanceKey } from "./reference";
import { loadReferenceData } from "./test-support/reference-csv";

const ref = loadReferenceData();

describe("reference data from data/reference", () => {
  it("loads every committed table", () => {
    expect(ref.outlets.size).toBe(120);
    expect(ref.vehicles.size).toBe(60);
    expect(ref.districts.size).toBe(12);
    expect(ref.serviceAllowances.size).toBe(9);
    expect(ref.calendar.size).toBe(910);
  });

  it("stores capacities, distances and fuel as integers", () => {
    expect(ref.vehicles.get("VEH001")).toMatchObject({
      type: "truck",
      temp: "reefer",
      weightCapG: 5_510_000,
      volumeCapL: 26_400,
      metresPerLitre: 4_700,
      weeklyFuelQuotaMl: 340_000,
    });
    expect(ref.districts.get("Gampaha")).toMatchObject({
      depotToDistrictM: 28_000,
      depotToDistrictMin: 37,
      interStopMin: 9,
    });
    for (const v of ref.vehicles.values()) {
      for (const n of [v.weightCapG, v.volumeCapL, v.metresPerLitre, v.weeklyFuelQuotaMl])
        expect(Number.isInteger(n)).toBe(true);
    }
  });

  it("parses outlet windows and mall windows to minutes", () => {
    expect(ref.outlets.get("OUT001")).toMatchObject({
      parking: "van_only",
      mallWindow: null,
      window: { open: 300, close: 450 },
    });
    const mall = [...ref.outlets.values()].find((o) => o.parking === "mall_dock");
    expect(mall?.mallWindow).not.toBeNull();
  });

  it("keys service allowances by brand and dock type", () => {
    expect(ref.serviceAllowances.get(serviceAllowanceKey("Fresh", "rear_dock"))?.minutes).toBe(15);
    expect(ref.serviceAllowances.get(serviceAllowanceKey("Style", "mall_bay"))?.minutes).toBe(59);
  });

  it("keeps zero runtime dependencies", () => {
    expect(pkg).not.toHaveProperty("dependencies");
  });
});
