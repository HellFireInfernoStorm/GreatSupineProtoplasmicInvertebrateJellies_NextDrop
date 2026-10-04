import { DEPOTS } from "../support/accounts";
import { ApiSession } from "../support/api";
import { STORY } from "../support/demo";
import { expect, test } from "../support/fixtures";

// The repeat-deferral walkthrough (#135, seed-and-demo.md): after a reset, the Kandy dispatcher defers ORD10412 again.
// It was carried over from Monday's run, so its hill-store outlet was skipped last run and D3 must ask for a
// justification. No seed or flag is changed: the deferral is the dispatcher's choice, made on the proposed draft.

interface DraftData {
  trips: { ref: string; vehicleId: string; tripNo: 1 | 2; orderIds: string[] }[];
  unassignedOrderIds: string[];
  deferrals: { orderId: string; reasonCode?: string; note?: string }[];
}
interface Draft {
  revision: number;
  data: DraftData;
}

const REPEAT_ORDER = "ORD10412";
const day = (path = "") => `/api/dispatch/days/${STORY.deliveryDay}${path}?depot=${DEPOTS.kandy}`;

test.describe.configure({ mode: "serial" });

test("the carried-over Kandy order can be deferred again only with a justification", async ({ demo, baseURL }) => {
  await demo.reset("before-cutoff");
  await demo.setClock(STORY.orderDay, "16:05");
  const api = await ApiSession.dispatcher(baseURL!, DEPOTS.kandy);
  try {
    const { queue } = await api.get<{ queue: { id: string; displayId: string }[] }>(day());
    const order = queue.find((candidate) => candidate.displayId === REPEAT_ORDER)!;
    expect(order, `${REPEAT_ORDER} is in the Kandy queue`).toBeTruthy();

    const { draft } = await api.post<{ draft: Draft }>(day("/propose"), { revision: 0 });
    expect(draft.data.trips.some((trip) => trip.orderIds.includes(order.id))).toBe(true);
    const deferred = (note?: string): DraftData => ({
      trips: draft.data.trips.map((trip) => ({ ...trip, orderIds: trip.orderIds.filter((id) => id !== order.id) })),
      unassignedOrderIds: [...draft.data.unassignedOrderIds, order.id],
      deferrals: [...draft.data.deferrals, { orderId: order.id, reasonCode: "OTHER", ...(note ? { note } : {}) }],
    });

    // Validation warns about the repeat but does not block it, so D3 can collect the note.
    const validation = await api.post<{ ok: boolean; violations: { code: string; orderIds: string[] }[] }>(
      day("/validate"),
      { data: deferred() },
    );
    expect(validation.ok).toBe(true);
    expect(validation.violations).toContainEqual(
      expect.objectContaining({ code: "REPEAT_DEFERRAL", orderIds: [order.id] }),
    );

    const saved = await api.put<{ draft: Draft }>(day("/draft"), { revision: draft.revision, data: deferred() });
    await expect(api.post(day("/publish"), { revision: saved.draft.revision })).rejects.toThrow(
      /MISSING_DEFERRAL_REASON/,
    );
    const noted = await api.put<{ draft: Draft }>(day("/draft"), {
      revision: saved.draft.revision,
      data: deferred("Reefer kept for the hospital run; store agreed to a Wednesday drop"),
    });
    await api.post(day("/publish"), { revision: noted.draft.revision });
  } finally {
    await api.dispose();
    await demo.reset("before-cutoff");
  }
});

// The D3 screen is #49 (PR #129, not merged yet). When it lands, drive the same deferral through the UI:
// reset to before-cutoff, advance the clock to 16:05, sign in as the Kandy dispatcher, Propose, defer ORD10412 from its trip, open review (D3).
test.fixme("D3 pins ORD10412 as deferred again, requires its note and previews its store notice (#129)", async () => {
  // Expect on D3: ORD10412 pinned first and labelled "Deferred again"; its justification field required; the
  // consequence line shows the next delivery date and two consecutive deferrals; the store-notice preview
  // is ORD10412's own notice. Publish is disabled with the note empty and enabled once it is filled; publishing
  // sends the hill store the deferral notice.
});
