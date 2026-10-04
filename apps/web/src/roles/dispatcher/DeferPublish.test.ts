import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { apiFixtures } from "@nextdrop/contracts";
import { DeferPublish } from "./DeferPublish";
import { emptyDraft, makeReference } from "./planning";
import { PublishSession } from "./publish-session";
import "../../i18n";

describe("D3 deferral screen", () => {
  it("renders editable reasons, repeat justification, consequences and history from fetched data", () => {
    const order = { ...apiFixtures.order, status: "ORDERED" as const, weightG: apiFixtures.vehicle.weightCapG + 1 };
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        {},
        createElement(DeferPublish, {
          day: {
            ...apiFixtures.dayResponse,
            queue: [order],
            planningContext: {
              ...apiFixtures.planningContext,
              outletService: [{ outletId: order.outletId, deferredLastRun: true, daysSinceLastServed: 7 }],
            },
          },
          data: emptyDraft([order.id]),
          outlets: [apiFixtures.outlet],
          reference: makeReference([apiFixtures.outlet], [apiFixtures.vehicle], [apiFixtures.calendarDay]),
          unavailable: new Set<string>(),
          breakdown: new Set<string>(),
          disabled: false,
          session: new PublishSession(),
          versions: [apiFixtures.planVersion],
          historyFailed: false,
          onHistoryRetry: () => {},
          onReload: () => {},
          onSave: async () => apiFixtures.draft,
          onPublish: async () => apiFixtures.publishResponse,
          onEditingChange: () => {},
        }),
      ),
    );
    expect(html).toContain("Previously deferred");
    expect(html).toContain("Justification (required)");
    expect(html).toContain("Unavoidable");
    expect(html).toContain("Next delivery");
    expect(html).toContain("0 now planned · 1 deferred again");
    expect(html).toContain("Preview only. This notice is sent when you publish.");
    expect(html).toContain("Order to defer:");
    expect(html).toContain("Version history");
    expect(html).toContain("Capacity: weight");
    expect(html).toContain(order.displayId);
    expect(html).toContain('disabled=""');
  });
});
