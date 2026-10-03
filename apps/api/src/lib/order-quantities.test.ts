import { describe, expect, it } from "vitest";
import { aggregateOrderQuantities } from "./order-quantities";

describe("exact order snapshot aggregation", () => {
  it.each(["3000000", "2147483.648"])("rejects a %s kg/m3 total beyond PostgreSQL Int storage", (size) => {
    expect(() => aggregateOrderQuantities([{ qtyOrdered: 1, unitWeightKg: size, unitVolumeM3: size }])).toThrow(
      RangeError,
    );
  });
  it("accepts the largest storable integer total", () => {
    expect(
      aggregateOrderQuantities([{ qtyOrdered: 1, unitWeightKg: "2147483.647", unitVolumeM3: "2147483.647" }]),
    ).toEqual({ weightG: 2147483647, volumeL: 2147483647 });
  });
  it.each(["0.0004", "0.0006"])("keeps a standalone %s kg/m3 item positive", (size) => {
    expect(aggregateOrderQuantities([{ qtyOrdered: 1, unitWeightKg: size, unitVolumeM3: size }])).toEqual({
      weightG: 1,
      volumeL: 1,
    });
  });
  it("sums exact snapshots before rounding instead of rounding every unit", () => {
    expect(aggregateOrderQuantities([{ qtyOrdered: 3, unitWeightKg: "0.0004", unitVolumeM3: "0.0004" }])).toEqual({
      weightG: 2,
      volumeL: 2,
    });
  });
  it("does not round up a decimal sum that is already an integer", () => {
    expect(
      aggregateOrderQuantities([
        { qtyOrdered: 1, unitWeightKg: "0.0004", unitVolumeM3: "0.0004" },
        { qtyOrdered: 1, unitWeightKg: "0.0006", unitVolumeM3: "0.0006" },
      ]),
    ).toEqual({ weightG: 1, volumeL: 1 });
  });
  it("supports milligram/millilitre snapshots", () => {
    expect(
      aggregateOrderQuantities([{ qtyOrdered: 1000, unitWeightKg: "0.000001", unitVolumeM3: "0.000001" }]),
    ).toEqual({
      weightG: 1,
      volumeL: 1,
    });
  });
  it("rejects empty or invalid totals instead of inventing an order", () => {
    expect(() => aggregateOrderQuantities([])).toThrow(RangeError);
    expect(() => aggregateOrderQuantities([{ qtyOrdered: 0, unitWeightKg: 1, unitVolumeM3: 1 }])).toThrow(RangeError);
  });
});
