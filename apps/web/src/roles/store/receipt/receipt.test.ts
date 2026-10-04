import { apiFixtures } from "@nextdrop/contracts";
import { describe, expect, it } from "vitest";
import { asDelivered, canReport, issueRequest, receiptRequest, receivedQty } from "./receipt";

const line = (id: string, qtyOrdered: number, qtyDelivered: number) => ({
  ...apiFixtures.order.lines[0]!,
  id,
  qtyOrdered,
  qtyDelivered,
});
const order = { ...apiFixtures.order, status: "DELIVERED" as const, lines: [line("a", 12, 8), line("b", 8, 8)] };

describe("confirming receipt", () => {
  it("starts from the driver's record", () => {
    expect(receivedQty(order, {}, "a")).toBe(8);
    expect(asDelivered(order, {})).toBe(true);
    expect(receiptRequest(order, {})).toEqual({
      lines: [
        { lineId: "a", qtyReceived: 8 },
        { lineId: "b", qtyReceived: 8 },
      ],
    });
  });
  it("sends the manager's own count where it differs", () => {
    const counted = { a: 7 };
    expect(asDelivered(order, counted)).toBe(false);
    expect(receiptRequest(order, counted).lines).toEqual([
      { lineId: "a", qtyReceived: 7 },
      { lineId: "b", qtyReceived: 8 },
    ]);
  });
  it("counts a changed-back quantity as delivered again", () => {
    expect(asDelivered(order, { a: 8 })).toBe(true);
  });
});

describe("reporting an issue", () => {
  it("names the line and quantity", () => {
    expect(issueRequest("WARM", "a", 1, " One crate warm. ")).toEqual({
      kind: "WARM",
      lines: [{ lineId: "a", qty: 1 }],
      note: "One crate warm.",
    });
  });
  it("can be about the whole order, with no note", () => {
    expect(issueRequest("OTHER", null, 0, "  ")).toEqual({ kind: "OTHER" });
  });
});

describe("when an issue can be reported", () => {
  it("is open after delivery, after receipt, and again on a Disputed order", () => {
    expect(["DELIVERED", "RECEIVED", "DISPUTED"].map((status) => canReport(status as "DELIVERED"))).toEqual([
      true,
      true,
      true,
    ]);
  });
  it("is closed before the delivery is made", () => {
    expect(canReport("OUT_FOR_DELIVERY")).toBe(false);
    expect(canReport("DEFERRED")).toBe(false);
  });
});
