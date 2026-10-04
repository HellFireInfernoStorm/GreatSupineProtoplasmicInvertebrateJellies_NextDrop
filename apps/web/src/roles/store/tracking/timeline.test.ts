import type { ApiDto } from "@nextdrop/contracts";
import { describe, expect, it } from "vitest";
import { stagesDone, timelineSteps } from "./timeline";

type Event = ApiDto<"orderDetail">["timeline"][number];

const ORDER = "018f1234-5678-7890-abcd-ef1234567001";
let n = 0;
const event = (patch: Pick<Event, "type" | "payload"> & Partial<Event>): Event =>
  ({
    id: `018f1234-5678-7890-abcd-ef12345680${String(n++).padStart(2, "0")}`,
    schemaVersion: 1,
    subject: { orderId: ORDER },
    source: "SERVER",
    actor: { userId: "u", role: "DISPATCHER" },
    capturedAt: "2026-10-03T00:00:00.000Z",
    receivedAt: "2026-10-03T00:00:00.000Z",
    disposition: "APPLIED",
    ...patch,
  }) as Event;

describe("an order's timeline", () => {
  it("keeps a field fact's two times apart", () => {
    const [step] = timelineSteps([
      event({
        type: "STOP_OUTCOME",
        source: "FIELD",
        actor: { userId: "d", role: "DRIVER" },
        payload: {
          outcome: "PARTIAL",
          lines: [
            { lineId: "a", qtyDelivered: 8 },
            { lineId: "b", qtyDelivered: 8 },
          ],
        },
        capturedAt: "2026-10-03T00:42:00.000Z",
        receivedAt: "2026-10-03T02:10:00.000Z",
      }),
    ]);
    expect(step).toMatchObject({
      kind: "delivered",
      params: { count: 16 },
      role: "DRIVER",
      capturedAt: "2026-10-03T00:42:00.000Z",
      confirmedAt: "2026-10-03T02:10:00.000Z",
    });
  });
  it("orders the steps by when they happened, not when they arrived", () => {
    const steps = timelineSteps([
      event({
        type: "RECEIPT_CONFIRMED",
        payload: { lines: [{ lineId: "a", qtyReceived: 8 }] },
        capturedAt: "2026-10-03T02:20:00.000Z",
      }),
      event({ type: "ORDER_OUT_FOR_DELIVERY", payload: {}, capturedAt: "2026-10-02T22:00:00.000Z" }),
    ]);
    expect(steps.map((step) => step.kind)).toEqual(["out", "received"]);
  });
  it("leaves out held events and events that are not the store's to read", () => {
    const steps = timelineSteps([
      event({ type: "STOP_OUTCOME", payload: { outcome: "FULL" }, disposition: "HELD" }),
      event({ type: "TRIP_DEPARTED", payload: { tripId: ORDER } }),
      event({ type: "STOP_OUTCOME", payload: { outcome: "REFUSED" } }),
    ]);
    expect(steps.map((step) => step.kind)).toEqual(["refused"]);
  });
  it("counts the stages an order has passed", () => {
    expect(stagesDone("ORDERED")).toBe(1);
    expect(stagesDone("DEFERRED")).toBe(1);
    expect(stagesDone("OUT_FOR_DELIVERY")).toBe(4);
    expect(stagesDone("DISPUTED")).toBe(6);
  });
});
