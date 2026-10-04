import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { apiFixtures, apiSchemas } from "@nextdrop/contracts";
import { staleQueries } from "../feed";
import { Evidence } from "./Evidence";
import {
  countByTab,
  currentTrip,
  exceptionKey,
  linkedException,
  nextStop,
  rememberPlaces,
  sortRuns,
  stopIndex,
  summarise,
  tabOf,
  type Exception,
  type Run,
} from "./model";
import "../../../i18n";

const base = apiFixtures.run as Run;
const run = (patch: Partial<Run>, id = base.vehicle.id): Run => ({
  ...base,
  vehicle: { ...base.vehicle, id, displayId: `VEH${id.slice(-3)}` },
  ...patch,
});
const trip = base.trips[0]!;
const departed = { ...trip, status: "DEPARTED" as const };

describe("D4 run cards", () => {
  it("puts silent and escalated runs first and finished runs last", () => {
    const runs = [
      run({ state: "DONE", trips: [{ ...trip, status: "COMPLETE" }] }, "0000-001"),
      run({ state: "ON_TRACK", trips: [departed] }, "0000-002"),
      run({ state: "NO_SIGNAL", trips: [departed] }, "0000-003"),
      run({ state: "ESCALATED", trips: [departed] }, "0000-004"),
      run({ state: "ON_TRACK", lateRisk: true, trips: [departed] }, "0000-005"),
    ];
    expect(sortRuns(runs).map((r) => r.state + (r.lateRisk ? "+late" : ""))).toEqual([
      "ESCALATED",
      "NO_SIGNAL",
      "ON_TRACK+late",
      "ON_TRACK",
      "DONE",
    ]);
  });

  it("summarises the heading chips from the server's states", () => {
    const summary = summarise([
      run({ state: "NO_SIGNAL", trips: [departed] }),
      run({ state: "ESCALATED", trips: [departed] }),
      run({ state: "ON_TRACK", trips: [{ ...trip, status: "READY" }] }),
      run({ state: "DONE", trips: [{ ...trip, status: "COMPLETE" }] }),
    ]);
    expect(summary).toEqual({ outForDelivery: 2, delivered: 1, lateRisk: 1, noSignal: 2, later: 1 });
  });

  it("names the next stop after the ones the server counts as done", () => {
    const stops = [1, 2, 3].map((seq) => ({ ...trip.stops[0]!, id: `${seq}`, seq }));
    const r = run({ stopsDone: 1, stopsTotal: 3, trips: [{ ...departed, stops: [stops[2]!, stops[0]!, stops[1]!] }] });
    expect(nextStop(r)?.seq).toBe(2);
    expect(currentTrip(r)?.status).toBe("DEPARTED");
    expect(nextStop({ ...r, state: "DONE" })).toBeNull();
  });
});

describe("D4 exceptions inbox", () => {
  const items = apiFixtures.exceptionsResponse.items as Exception[];

  it("files every exception type under one tab and counts them", () => {
    const tabs = items.map(tabOf);
    expect(tabs).toContain("clashes");
    const counts = countByTab(items);
    expect(counts.all).toBe(items.length);
    expect(counts.clashes + counts.shortfalls + counts.disputes + counts.other).toBe(items.length);
  });

  it("selects the item a notification links to", () => {
    const clash = items.find((item) => item.type === "CONFLICT")!;
    expect(linkedException(items, { exception: exceptionKey(clash) })).toBe(clash);
    expect(linkedException(items, { order: clash.type === "CONFLICT" ? clash.conflict.orderId : null })).toBe(clash);
    expect(linkedException(items, { exception: "missing" })).toBeNull();
  });

  it("remembers a stop after a plan change removes it from the runs", () => {
    const seen = rememberPlaces(new Map(), [base]);
    const orderId = trip.stops[0]!.order.id;
    const after = rememberPlaces(seen, [{ ...base, trips: [{ ...trip, stops: [] }] }]);
    expect(after.get(orderId)?.stop.order.displayId).toBe(trip.stops[0]!.order.displayId);
    expect(stopIndex([{ ...base, trips: [{ ...trip, stops: [] }] }]).has(orderId)).toBe(false);
  });
});

describe("D4 change feed", () => {
  it("refreshes the runs and the inbox for run, clash and order rows", () => {
    expect([...staleQueries([{ kind: "run_updated" }])].sort()).toEqual(["exceptions", "runs"]);
    expect(staleQueries([{ kind: "conflict_opened" }]).has("exceptions")).toBe(true);
    expect(staleQueries([{ kind: "notification_created" }])).toEqual(new Set(["notifications"]));
    expect(staleQueries([])).toEqual(new Set());
  });
});

describe("D4 evidence panel", () => {
  const render = (item: Exception) =>
    renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(Evidence, {
          item,
          place: stopIndex([base]).get(trip.stops[0]!.order.id) ?? null,
          tripLabel: trip.displayId,
          depot: "Peliyagoda",
          online: true,
          onResolved: () => undefined,
        }),
      ),
    );

  it("shows a sync clash's plan change beside the driver's proof, with accept and reject", () => {
    const clash = apiSchemas.exception.parse({
      type: "CONFLICT",
      conflict: { ...apiFixtures.conflict, orderId: trip.stops[0]!.order.id },
      evidence: [apiFixtures.conflict.id],
    }) as Exception;
    const html = render(clash);
    expect(html).toContain("Sync clash");
    expect(html).toContain("Plan change");
    expect(html).toContain("Driver proof of delivery");
    expect(html).toContain(`/api/blobs/${apiFixtures.conflict.id}`);
    expect(html).toContain("Accept fact");
    expect(html).toContain("Reject fact");
  });

  it("offers the three dispute outcomes with the store photo beside the driver's proof", () => {
    const html = render(
      apiSchemas.exception.parse({
        type: "ISSUE",
        issue: { ...apiFixtures.issue, orderId: trip.stops[0]!.order.id },
        evidence: [],
      }) as Exception,
    );
    expect(html).toContain("Store photo");
    expect(html).toContain("Driver proof of delivery");
    for (const label of ["Credit", "Add to next run", "Reject with note"]) expect(html).toContain(label);
  });

  it("proposes shipping partial for a shortfall", () => {
    const html = render(
      apiSchemas.exception.parse({
        type: "SHORT",
        orderId: trip.stops[0]!.order.id,
        lineId: trip.stops[0]!.order.lines[0]!.id,
        qtyShort: 2,
        resolution: null,
      }) as Exception,
    );
    expect(html).toMatch(/checked="" value="SHIP_PARTIAL"/);
    expect(html).toContain("Hold trip");
    expect(html).toContain("Backorder");
  });
});
