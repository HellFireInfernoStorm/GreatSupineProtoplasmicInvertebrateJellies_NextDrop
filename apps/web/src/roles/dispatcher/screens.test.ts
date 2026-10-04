import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { apiFixtures } from "@nextdrop/contracts";
import { Dashboard } from "./Dashboard";
import { ValidationChecks } from "./ValidationChecks";
import { OrderQueue } from "./OrderQueue";
import { PlanBoard } from "./PlanBoard";
import { makeReference, validationContext } from "./planning";
import "../../i18n";

describe("dispatcher screen data", () => {
  it("offers Unassigned for a planned stop before a pinned loaded stop", () => {
    const planned = { ...apiFixtures.order, status: "PLANNED" as const };
    const loaded = { ...planned, id: "01930b7e-0000-7000-8000-000000000098", status: "LOADED" as const };
    const reference = makeReference([apiFixtures.outlet], [apiFixtures.vehicle], [apiFixtures.calendarDay]);
    const context = validationContext(
      {
        ...apiFixtures.planningContext,
        publishedStops: [planned, loaded].map((order, index) => ({
          orderId: order.id,
          vehicleId: apiFixtures.vehicle.id,
          tripNo: 1,
          seq: index + 1,
          locked: index === 1,
          departed: false,
        })),
        loadedOrders: [{ orderId: loaded.id, vehicleId: apiFixtures.vehicle.id, tripNo: 1, reversalRequested: false }],
      },
      reference,
    );
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        {},
        createElement(PlanBoard, {
          data: {
            trips: [{ ref: "T001", vehicleId: apiFixtures.vehicle.id, tripNo: 1, orderIds: [planned.id, loaded.id] }],
            unassignedOrderIds: [],
            deferrals: [],
          },
          orders: [planned, loaded],
          outlets: [apiFixtures.outlet],
          vehicles: [apiFixtures.vehicle],
          reference,
          context,
          unavailable: new Set<string>(),
          date: planned.currentDate,
          disabled: false,
          busy: false,
          onSave: async () => true,
          onEditingChange: () => {},
        }),
      ),
    );
    const menus = html.match(/<select[\s\S]*?<\/select>/g)!;
    expect(menus).toHaveLength(2);
    expect(menus[0]).not.toContain('disabled=""');
    expect(menus[0]).toContain('value="unassigned"');
    expect(menus[1]).toContain('disabled=""');
  });
  it("shows departed stops, disables reported cards and permits only safe later-stop destinations", () => {
    const reported = { ...apiFixtures.order, status: "DELIVERED" as const };
    const later = {
      ...reported,
      id: "01930b7e-0000-7000-8000-000000000098",
      displayId: "ORDLATER",
      status: "OUT_FOR_DELIVERY" as const,
    };
    const otherVehicle = { ...apiFixtures.vehicle, id: "01930b7e-0000-7000-8000-000000000099", displayId: "VEH002" };
    const vehicles = [apiFixtures.vehicle, otherVehicle];
    const reference = makeReference([apiFixtures.outlet], vehicles, [apiFixtures.calendarDay]);
    const context = validationContext(
      {
        ...apiFixtures.planningContext,
        publishedStops: [reported, later].map((order, index) => ({
          orderId: order.id,
          vehicleId: apiFixtures.vehicle.id,
          tripNo: 1,
          seq: index + 1,
          locked: index === 0,
          departed: true,
        })),
      },
      reference,
    );
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        {},
        createElement(PlanBoard, {
          data: {
            trips: [
              { ref: "T001", vehicleId: apiFixtures.vehicle.id, tripNo: 1, orderIds: [reported.id, later.id] },
              { ref: "T002", vehicleId: otherVehicle.id, tripNo: 1, orderIds: [] },
            ],
            unassignedOrderIds: [],
            deferrals: [],
          },
          orders: [reported, later],
          outlets: [apiFixtures.outlet],
          vehicles,
          reference,
          context,
          unavailable: new Set<string>(),
          date: reported.currentDate,
          disabled: false,
          busy: false,
          onSave: async () => true,
          onEditingChange: () => {},
        }),
      ),
    );
    const menus = html.match(/<select[\s\S]*?<\/select>/g)!;
    expect(menus).toHaveLength(2);
    expect(html).toContain("Locked");
    expect(menus[0]).toContain('disabled=""');
    expect(menus[1]).not.toContain('disabled=""');
    expect(menus[1]).toContain('value="T001"');
    expect(menus[1]).toContain('value="unassigned"');
    expect(menus[1]).not.toContain('value="T002"');
  });
  it("shows previous-run deferral separately from lifetime order history", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        {},
        createElement(OrderQueue, {
          day: {
            ...apiFixtures.dayResponse,
            planningContext: {
              ...apiFixtures.planningContext,
              outletService: [{ outletId: apiFixtures.outlet.id, daysSinceLastServed: 7, deferredLastRun: true }],
            },
          },
          outlets: [apiFixtures.outlet],
          vehicles: [apiFixtures.vehicle],
        }),
      ),
    );
    expect(html).toContain("Skipped previous run");
    expect(html).not.toContain("Previously deferred");
  });
  it("renders workshop attention and real queue counts without invented story totals", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        {},
        createElement(Dashboard, {
          day: apiFixtures.dayResponse,
          data: apiFixtures.draftData,
          vehicles: [apiFixtures.vehicle],
          outlets: [apiFixtures.outlet],
          workshop: [apiFixtures.vehicle],
          runs: null,
          exceptions: null,
        }),
      ),
    );
    expect(html).toContain(apiFixtures.vehicle.displayId);
    expect(html).toContain("workshop");
    expect(html).not.toContain("52.4");
    expect(html).toContain("Unavailable");
  });
  it("retains passing checks beside numeric hard violations", () => {
    const html = renderToStaticMarkup(createElement(ValidationChecks, { result: apiFixtures.validationResult }));
    expect(html).toContain("Weight");
    expect(html).toContain("Volume");
    expect(html).toContain("over");
    expect(html).toContain("Temperature");
  });
  it("summarises late arrivals once and identifies affected trips without technical copy", () => {
    const risk = { ...apiFixtures.violation, code: "LATE_RISK" as const, severity: "WARN" as const };
    const html = renderToStaticMarkup(
      createElement(ValidationChecks, {
        result: {
          ok: true,
          violations: [
            { ...risk, tripRef: "T001", orderIds: ["order-a"] },
            { ...risk, tripRef: "T001", orderIds: ["order-b"] },
            { ...risk, tripRef: "T002", orderIds: ["order-c"] },
          ],
        },
        contextAvailable: true,
      }),
    );
    expect(html.match(/orders may arrive after their delivery window/g)).toHaveLength(1);
    expect(html).toContain("3 orders may arrive");
    expect(html).toContain("Review 2 affected trips");
    expect(html).toContain("T001, T002");
    expect(html).not.toContain("Display ETA");
    expect(html).not.toContain("Local checks use");
    expect(html).not.toContain("All available checks pass");
  });
});
