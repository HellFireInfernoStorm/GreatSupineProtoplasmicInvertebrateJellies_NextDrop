import { describe, expect, it } from "vitest";
import { lockedStopChange, type PublishedStop } from "./planning-locks";
const stops: PublishedStop[] = [
  { orderId: "A", vehicleId: "V", tripNo: 1, seq: 1, locked: true, departed: true },
  { orderId: "B", vehicleId: "V", tripNo: 1, seq: 2, locked: false, departed: true },
  { orderId: "C", vehicleId: "V", tripNo: 1, seq: 3, locked: false, departed: true },
];
const slot = (orderId: string, seq: number, vehicleId = "V", tripNo = 1) => ({ orderId, seq, vehicleId, tripNo });
describe("departed stop edits", () => {
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
    expect(lockedStopChange(middle, [slot("C", 1), slot("B", 2), slot("A", 3)])).toBe("C");
  });
  it("refuses adding cargo to a departed truck", () => {
    expect(lockedStopChange(stops, [slot("A", 1), slot("D", 2)])).toBe("D");
  });
});
