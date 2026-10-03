import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ORDER_STATUSES } from "@nextdrop/contracts";
import { statusTone } from "./status";
import { CapacityBar } from "./CapacityBar";
import { capacityRatio } from "./capacity";
import { Timeline } from "./Timeline";
import { FormField } from "./FormField";
import { Button } from "./Button";
import { SyncPill } from "./StatusPill";
import { TripCard } from "./Cards";
import "../i18n";

describe("shared display kit", () => {
  it("keeps the trip departure day separate from its primary 24-hour time", () => {
    const html = render(
      h(TripCard, { id: "TRIP-1", vehicle: "Truck", departure: "2026-10-03T18:00:00Z", status: "PLANNED" }),
    );
    expect(html).toContain('dateTime="2026-10-03T18:00:00Z"');
    expect(html).toContain('<span class="nd-trip-day">Sat 3 Oct</span>');
    expect(html).toContain('<span class="nd-trip-time">23:30</span>');
    expect(() =>
      render(h(TripCard, { id: "TRIP-1", vehicle: "Truck", departure: "2026-10-03T18:00:00", status: "PLANNED" })),
    ).toThrow();
  });
  it("covers contract statuses and rejects flags as statuses", () => {
    const expected = {
      ORDERED: "neutral",
      PLANNED: "info",
      DEFERRED: "deferred",
      CANCELLED: "neutral",
      LOADED: "info",
      OUT_FOR_DELIVERY: "info",
      DELIVERED: "ok",
      FAILED: "danger",
      RECEIVED: "ok",
      DISPUTED: "danger",
    };
    expect(Object.keys(expected).sort()).toEqual([...ORDER_STATUSES].sort());
    for (const status of ORDER_STATUSES) expect(statusTone(status)).toBe(expected[status]);
    expect(statusTone("DEFERRED")).toBe("deferred");
    expect(() => statusTone("SHORT" as never)).toThrow();
  });
  it("clamps only the capacity fill and retains overflow counts", () => {
    expect(capacityRatio(12, 10)).toBe(1);
    expect(capacityRatio(4, 0)).toBeNull();
    expect(capacityRatio(-1, 10)).toBeNull();
    const html = render(h(CapacityBar, { label: "Weight", used: 12, capacity: 10, unit: "kg" }));
    expect(html).toContain('data-tone="danger"');
    expect(html).toContain('aria-valuenow="10"');
    expect(html).toContain('data-used="12"');
  });
  it("preserves separate capture and confirmation instants across days", () => {
    const html = render(
      h(Timeline, {
        events: [
          { id: "fact", title: "Delivered", capturedAt: "2026-10-03T18:00:00Z", confirmedAt: "2026-10-04T02:10:00Z" },
        ],
      }),
    );
    expect(html).toContain('dateTime="2026-10-03T18:00:00Z"');
    expect(html).toContain('dateTime="2026-10-04T02:10:00Z"');
    expect(html).toContain("23:30");
    expect(html).toContain("07:40");
    expect(html).toContain("Sat 3 Oct");
    expect(html).toContain("Sun 4 Oct");
  });
  it("does not invent confirmation and rejects invalid dates", () => {
    const event = { id: "pending", title: "Loaded", capturedAt: "2026-10-03T18:00:00Z", confirmedAt: null };
    expect(render(h(Timeline, { events: [event] })).match(/dateTime=/g)).toHaveLength(1);
    expect(() => render(h(Timeline, { events: [{ ...event, capturedAt: "invalid" }] }))).toThrow();
  });
  it("associates field labels, hints and errors with the control", () => {
    const html = render(
      h(FormField, {
        id: "qty",
        label: "Quantity",
        hint: "Crates",
        error: "Required",
        required: true,
        children: h("input", { "aria-describedby": "external" }),
      }),
    );
    expect(html).toContain('for="qty"');
    expect(html).toContain('aria-describedby="external qty-hint qty-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("required");
  });
  it("disables loading activation and makes offline amber", () => {
    expect(render(h(Button, { loading: true, children: "Save" }))).toContain('aria-busy="true"');
    expect(render(h(Button, { loading: true, children: "Save" }))).toContain("disabled");
    expect(render(h(SyncPill, { state: "offline" }))).toContain('data-tone="warn"');
    expect(render(h(SyncPill, { state: "seen" }))).toContain('data-tone="info"');
  });
});
