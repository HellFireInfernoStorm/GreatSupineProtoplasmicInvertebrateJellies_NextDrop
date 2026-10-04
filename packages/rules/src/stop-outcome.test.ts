import { expect, it } from "vitest";
import { ORDER_STATUSES, type StopOutcome } from "./order-reducer";
import { isDriverStopTerminal, validateStopOutcome } from "./stop-outcome";

it("excludes terminal orders from further driver recording", () => {
  expect(ORDER_STATUSES.filter(isDriverStopTerminal)).toEqual([
    "CANCELLED",
    "DELIVERED",
    "FAILED",
    "RECEIVED",
    "DISPUTED",
  ]);
});
it("validates quantities, partial outcomes and proof with stable reason codes", () => {
  const input = {
    lines: [{ id: "line", qtyLoaded: 4 }],
    outcome: "FULL" as StopOutcome,
    quantities: { line: 2 },
    reason: "OTHER",
    receiver: "Nimal",
    photos: ["photo"],
  };
  expect(validateStopOutcome(input)).toEqual({
    codes: [],
    lines: [{ lineId: "line", qtyDelivered: 4, qtyReturned: 0 }],
  });
  expect(validateStopOutcome({ ...input, outcome: "PARTIAL" })).toEqual({
    codes: [],
    lines: [{ lineId: "line", qtyDelivered: 2, qtyReturned: 2 }],
  });
  for (const line of [-1, 5, 1.5, NaN, Infinity])
    expect(validateStopOutcome({ ...input, outcome: "PARTIAL", quantities: { line } }).codes).toContain(
      "INVALID_DELIVERY_QUANTITY",
    );
  expect(validateStopOutcome({ ...input, outcome: "PARTIAL", quantities: {} }).codes).toContain(
    "INVALID_DELIVERY_QUANTITY",
  );
  for (const line of [0, 4])
    expect(validateStopOutcome({ ...input, outcome: "PARTIAL", quantities: { line } }).codes).toContain(
      "INVALID_PARTIAL",
    );
  for (const outcome of ["PARTIAL", "REFUSED", "FAILED"] as const) {
    expect(validateStopOutcome({ ...input, outcome, photos: [], signature: "ink" }).codes).toContain(
      "REASON_PHOTO_REQUIRED",
    );
    expect(validateStopOutcome({ ...input, outcome, reason: " " }).codes).toContain("REASON_PHOTO_REQUIRED");
  }
  for (const outcome of ["REFUSED", "FAILED"] as const)
    expect(validateStopOutcome({ ...input, outcome }).lines).toEqual([
      { lineId: "line", qtyDelivered: 0, qtyReturned: 4 },
    ]);
  expect(validateStopOutcome({ ...input, photos: [] }).codes).toEqual(["PROOF_REQUIRED"]);
  expect(validateStopOutcome({ ...input, receiver: " " }).codes).toEqual(["PROOF_REQUIRED"]);
  expect(validateStopOutcome({ ...input, photos: [], signature: "ink" }).codes).toEqual([]);
});
