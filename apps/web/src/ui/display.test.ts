import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ORDER_STATUSES } from "@nextdrop/contracts";
import { statusTone } from "./status";
import { CapacityBar } from "./CapacityBar";
import { capacityRatio } from "./capacity";
import { Timeline } from "./Timeline";
import { FormField } from "./FormField";
import { Button } from "./Button";
import { StatusPill, SyncPill } from "./StatusPill";
import { TripCard } from "./Cards";
import "../i18n";
afterEach(() => vi.useRealTimers());

describe("shared display kit", () => {
  it("keeps the trip departure day separate from its primary 24-hour time", () => {
    const html = render(
      h(TripCard, { id: "TRIP-1", vehicle: "Truck", departure: "2026-10-03T18:00:00Z", status: "PLANNED" }),
    );
    expect(html).toContain('dateTime="2026-10-03T18:00:00Z"');
    expect(html).toContain('<span class="nd-trip-day">Sat 3 Oct</span>');
    expect(html).toContain('<span class="nd-trip-time">23:30</span>');
    expect(
      render(h(TripCard, { id: "TRIP-1", vehicle: "Truck", departure: "2026-10-03T18:00:00", status: "PLANNED" })),
    ).toContain("Time unavailable");
  });
  it("covers contract statuses and degrades unknown display values to neutral", () => {
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
    expect(statusTone("SHORT" as never)).toBe("neutral");
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
  it("formats floating measurements in both visible and accessible capacity text", () => {
    const html = render(h(CapacityBar, { label: "Volume", used: 0.1 + 0.2, capacity: 12, unit: "m³" }));
    expect(html).toContain("0.3 / 12 m³");
    expect(html).toContain('aria-valuetext="0.3 / 12 m³"');
    expect(html).not.toContain("0.30000000000000004 /");
  });
  it("gives a summary's capacity, share and headroom instead of repeating the used amount", () => {
    const spare = render(
      h(CapacityBar, { label: "Weight", used: 0.01, capacity: 5, unit: "t", presentation: "summary" }),
    );
    expect(spare).toContain("<strong>0.01 t</strong>");
    expect(spare).toContain("<small>of 5 t · 0% · 4.99 t spare</small>");
    expect(spare).toContain('aria-valuetext="0.01 / 5 t"');
    const over = render(
      h(CapacityBar, { label: "Chilled", used: 13.2, capacity: 12, unit: "m³", presentation: "summary" }),
    );
    expect(over).toContain("<small>of 12 m³ · 110% · 1.2 m³ over</small>");
    const unknown = render(h(CapacityBar, { label: "Loaded", used: 3, unit: "kg", presentation: "summary" }));
    expect(unknown).toContain("<small>Capacity unavailable</small>");
  });
  it("omits today's day while retaining the day on older field facts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T03:00:00Z"));
    const html = render(
      h(Timeline, {
        events: [
          { id: "fact", title: "Delivered", capturedAt: "2026-10-03T18:00:00Z", confirmedAt: "2026-10-04T02:10:00Z" },
        ],
      }),
    );
    expect(html).toContain("Sat 3 Oct");
    expect(html).not.toContain("Sun 4 Oct");
    expect(html).toContain("07:40");
  });
  it("does not mistake the same weekday and month/day in a different year for today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T03:00:00Z"));
    const html = render(
      h(Timeline, {
        events: [{ id: "old", title: "Delivered", capturedAt: "2020-10-04T02:00:00Z", confirmedAt: null }],
      }),
    );
    expect(html).toContain("Sun 4 Oct");
  });
  it("isolates unknown order statuses", () => {
    const status = render(h(StatusPill, { status: "NEW_SERVER_STATE" as never }));
    expect(status).toContain('data-tone="neutral"');
    expect(status).toContain("Unknown status");
  });
  it("isolates ambiguous timestamps without inventing a time", () => {
    const html = render(
      h(Timeline, { events: [{ id: "bad", title: "Recorded", capturedAt: "2026-10-03T18:00:00", confirmedAt: null }] }),
    );
    expect(html).toContain("Time unavailable");
    expect(html).not.toContain("dateTime=");
    expect(render(h(TripCard, { id: "trip", vehicle: "Truck", status: "READY", departure: "invalid" }))).toContain(
      "Time unavailable",
    );
  });
  it("preserves separate capture and confirmation instants across days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T03:00:00Z"));
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
  it("does not invent confirmation or an invalid date", () => {
    const event = { id: "pending", title: "Loaded", capturedAt: "2026-10-03T18:00:00Z", confirmedAt: null };
    expect(render(h(Timeline, { events: [event] })).match(/dateTime=/g)).toHaveLength(1);
    expect(render(h(Timeline, { events: [{ ...event, capturedAt: "invalid" }] }))).toContain("Time unavailable");
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
