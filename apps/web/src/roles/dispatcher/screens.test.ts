import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { apiFixtures } from "@nextdrop/contracts";
import { Dashboard } from "./Dashboard";
import { ValidationChecks } from "./ValidationChecks";
import { OrderQueue } from "./OrderQueue";
import "../../i18n";

describe("dispatcher screen data", () => {
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
