import { describe, expect, it } from "vitest";
import { apiFixtures } from "@nextdrop/contracts";
import { emptyDraft, makeReference } from "./planning";
import { buildDeferralReview, reviewDraft } from "./deferral-review";

const order = { ...apiFixtures.order, status: "ORDERED" as const, weightG: apiFixtures.vehicle.weightCapG + 1 };
const day = { ...apiFixtures.dayResponse, queue: [order], date: order.currentDate };
const reference = makeReference([apiFixtures.outlet], [apiFixtures.vehicle], [apiFixtures.calendarDay]);
describe("D3 shared-rule review", () => {
  it("sorts repeats first, then longest unserved time, deferral count and display ID", () => {
    const repeatOutletId = "01930b7e-0000-7000-8000-000000000008";
    const inputs = [
      {
        ...order,
        id: "01930b7e-0000-7000-8000-000000000011",
        displayId: "ORD1",
        requestedDate: "2026-09-28",
        deferredCount: 1,
      },
      {
        ...order,
        id: "01930b7e-0000-7000-8000-000000000012",
        displayId: "ORD2",
        requestedDate: "2026-09-28",
        deferredCount: 3,
      },
      {
        ...order,
        id: "01930b7e-0000-7000-8000-000000000013",
        displayId: "ORD3",
        requestedDate: "2026-09-25",
        deferredCount: 0,
      },
      {
        ...order,
        id: "01930b7e-0000-7000-8000-000000000014",
        displayId: "ORD4",
        requestedDate: "2026-09-29",
        deferredCount: 0,
        outletId: repeatOutletId,
      },
      {
        ...order,
        id: "01930b7e-0000-7000-8000-000000000015",
        displayId: "ORD5",
        requestedDate: "2026-09-28",
        deferredCount: 1,
      },
    ];
    const scoped = {
      ...day,
      date: "2026-09-29",
      queue: inputs,
      planningContext: {
        ...day.planningContext,
        outletService: [{ outletId: repeatOutletId, deferredLastRun: true, daysSinceLastServed: 1 }],
      },
    };
    const ref = makeReference(
      [apiFixtures.outlet, { ...apiFixtures.outlet, id: repeatOutletId, displayId: "OUT002" }],
      [apiFixtures.vehicle],
      [apiFixtures.calendarDay],
    );
    const rows = buildDeferralReview(emptyDraft(inputs.map((row) => row.id)), scoped, ref, new Set(), new Set());
    expect(rows.map((row) => row.order.displayId)).toEqual(["ORD4", "ORD3", "ORD2", "ORD1", "ORD5"]);
  });
  it("prefills an infeasible reason and consequence without changing the source draft", () => {
    const data = emptyDraft([order.id]);
    const rows = buildDeferralReview(data, day, reference, new Set(), new Set());
    expect(rows[0]?.explanation).toMatchObject({ reasonCode: "CAPACITY_WEIGHT", causeKind: "UNAVOIDABLE_INFEASIBLE" });
    expect(reviewDraft(data, rows).deferrals).toEqual([{ orderId: order.id, reasonCode: "CAPACITY_WEIGHT", note: "" }]);
    expect(data.deferrals).toEqual([]);
  });
  it("preserves manual codes and notes while the cause still comes from shared rules", () => {
    const data = {
      ...emptyDraft([order.id]),
      deferrals: [{ orderId: order.id, reasonCode: "OTHER" as const, note: "Dispatcher note" }],
    };
    const row = buildDeferralReview(data, day, reference, new Set(), new Set())[0]!;
    expect(row.reasonCode).toBe("OTHER");
    expect(row.note).toBe("Dispatcher note");
    expect(row.explanation.causeKind).toBe("UNAVOIDABLE_INFEASIBLE");
  });
  it("pins server previous-run state rather than lifetime deferral count, and uses future holidays", () => {
    const second = {
      ...order,
      id: "01930b7e-0000-7000-8000-000000000009",
      outletId: "01930b7e-0000-7000-8000-000000000008",
      displayId: "ORD2",
      deferredCount: 4,
    };
    const pinned = { ...order, requestedDate: "2026-10-03", currentDate: "2026-10-03" };
    const scoped = {
      ...day,
      date: "2026-10-03",
      queue: [second, pinned],
      planningContext: {
        ...day.planningContext,
        outletService: [{ outletId: order.outletId, daysSinceLastServed: 7, deferredLastRun: true }],
      },
    };
    const ref = makeReference(
      [apiFixtures.outlet, { ...apiFixtures.outlet, id: second.outletId, displayId: "OUT002" }],
      [apiFixtures.vehicle],
      [{ ...apiFixtures.calendarDay, date: "2026-10-05", isOperating: false }],
    );
    const rows = buildDeferralReview(emptyDraft([second.id, pinned.id]), scoped, ref, new Set(), new Set());
    expect(rows.map((r) => r.order.id)).toEqual([pinned.id, second.id]);
    expect(rows[0]).toMatchObject({
      repeat: true,
      needsNote: true,
      explanation: { nextServiceableDate: "2026-10-06" },
    });
    expect(rows[1]?.repeat).toBe(false);
  });
});
