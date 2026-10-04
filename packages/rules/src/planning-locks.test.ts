import { describe, expect, it } from "vitest";
import { lockedStopChange, type PublishedStop } from "./planning-locks";
const stops: PublishedStop[] = [
  { orderId: "A", vehicleId: "V", tripNo: 1, seq: 1, locked: true, departed: true },
  { orderId: "B", vehicleId: "V", tripNo: 1, seq: 2, locked: false, departed: true },
  { orderId: "C", vehicleId: "V", tripNo: 1, seq: 3, locked: false, departed: true },
];
const slot = (orderId: string, seq: number, vehicleId = "V", tripNo = 1) => ({ orderId, seq, vehicleId, tripNo });
describe("departed stop edits", () => {
  it("allows deferring a planned stop before a pinned loaded stop", () => {
    const loading = stops.slice(0, 2).map((s) => ({ ...s, locked: s.orderId === "B", departed: false }));
    expect(lockedStopChange(loading, [slot("B", 1)])).toBeNull();
    expect(lockedStopChange(loading, [slot("A", 1, "W"), slot("B", 1)])).toBeNull();
  });
  it("allows removing an unreported stop before a reported departed stop", () => {
    const outOfOrder = stops.map((s) => ({ ...s, locked: s.orderId === "B" }));
    expect(lockedStopChange(outOfOrder, [slot("B", 1), slot("C", 2)])).toBeNull();
  });
  it("compares the departed boundary after locked stops compact", () => {
    const current = stops.map((s) => ({ ...s, locked: s.orderId === "B" }));
    expect(lockedStopChange(current, [slot("B", 1), slot("C", 2)])).toBeNull();
    expect(lockedStopChange(current, [slot("C", 1), slot("B", 2)])).toBe("B");
  });
  it("allows earlier unreported stops to compact without crossing a reported stop", () => {
    const current = stops.map((s) => ({ ...s, locked: s.orderId === "C" }));
    expect(lockedStopChange(current, [slot("B", 1), slot("C", 2)])).toBeNull();
  });
  it("keeps locked stops on their vehicle and trip", () => {
    expect(lockedStopChange(stops, [slot("A", 1, "W"), slot("B", 2), slot("C", 3)])).toBe("A");
    expect(lockedStopChange(stops, [slot("A", 1, "V", 2), slot("B", 2), slot("C", 3)])).toBe("A");
  });
  it("keeps relative locked order even with unsorted published input", () => {
    const locked = stops.map((s) => ({ ...s, locked: s.orderId !== "B", departed: false })).reverse();
    expect(lockedStopChange(locked, [slot("A", 1), slot("C", 2)])).toBeNull();
    expect(lockedStopChange(locked, [slot("C", 1), slot("A", 2)])).not.toBeNull();
  });
  it("refuses removal, reordering, moving or adding cargo when every departed stop is locked (COMPLETE)", () => {
    const complete = stops.map((s) => ({ ...s, locked: true }));
    expect(lockedStopChange(complete, [slot("A", 1), slot("B", 2), slot("C", 3)])).toBeNull();
    for (const changed of [
      [slot("A", 1), slot("B", 2)],
      [slot("B", 1), slot("A", 2), slot("C", 3)],
      [slot("A", 1, "W"), slot("B", 2), slot("C", 3)],
      [slot("A", 1), slot("B", 2), slot("C", 3), slot("D", 4)],
    ])
      expect(lockedStopChange(complete, changed)).not.toBeNull();
  });
  it("allows removing and resequencing later stops", () => {
    expect(lockedStopChange(stops, [slot("A", 1), slot("C", 2)])).toBeNull();
    expect(lockedStopChange(stops, [slot("A", 1), slot("C", 2), slot("B", 3)])).toBeNull();
  });
  it("locks field facts and complete trips", () => {
    expect(lockedStopChange(stops, [slot("A", 2), slot("B", 1)])).toBe("A");
    expect(lockedStopChange(stops, [slot("B", 2)])).toBe("A");
    expect(
      lockedStopChange(
        stops.map((s) => ({ ...s, locked: true })),
        [slot("A", 1), slot("B", 2)],
      ),
    ).toBe("C");
  });
  it("refuses another vehicle/trip or moving before a locked stop", () => {
    expect(lockedStopChange(stops, [slot("A", 1), slot("B", 2, "W")])).toBe("B");
    expect(lockedStopChange(stops, [slot("A", 1), slot("B", 2, "V", 2)])).toBe("B");
    const middle = stops.map((s) => ({ ...s, locked: s.orderId === "B" }));
    expect(lockedStopChange(middle, [slot("C", 1), slot("B", 2), slot("A", 3)])).toBe("B");
  });
  it("refuses adding cargo to a departed truck", () => {
    expect(lockedStopChange(stops, [slot("A", 1), slot("D", 2)])).toBe("D");
  });
});
