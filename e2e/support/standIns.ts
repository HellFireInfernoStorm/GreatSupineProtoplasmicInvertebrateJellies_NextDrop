import { DEPOTS } from "./accounts";
import { ApiSession } from "./api";
import { STORY } from "./demo";

// Stand-ins for walkthrough steps whose screens are not merged yet (issue #62, delivery in stages).
//
// A later step can only run if the earlier ones happened. While an earlier step is still `test.fixme`, the stand-in
// here does through the API what that step will do through the screen, so the later step can already be a real one.
// Each stand-in names the steps it replaces. Delete it in the PR that turns those steps into real ones.

interface DraftData {
  trips: { ref: string; vehicleId: string; tripNo: 1 | 2; orderIds: string[] }[];
  unassignedOrderIds: string[];
  deferrals: { orderId: string; reasonCode?: string; note?: string }[];
}
interface Draft {
  revision: number;
  data: DraftData;
}

const day = (path = "") => `/api/dispatch/days/${STORY.deliveryDay}${path}?depot=${DEPOTS.peliyagoda}`;

/**
 * Stands in for steps 3 to 5 (dispatcher D0-D3, issues #46 and #49): propose the Peliyagoda plan, take one order
 * off its trip as a dispatcher's choice, and publish. Step 6 needs a store with one planned and one deferred order.
 */
export async function publishPlanDeferring(baseURL: string, orderDisplayId: string): Promise<void> {
  const api = await ApiSession.dispatcher(baseURL, DEPOTS.peliyagoda);
  try {
    const { queue } = await api.get<{ queue: { id: string; displayId: string }[] }>(day());
    const order = queue.find((candidate) => candidate.displayId === orderDisplayId);
    if (!order) throw new Error(`${orderDisplayId} is not in the ${DEPOTS.peliyagoda} queue for ${STORY.deliveryDay}`);

    const current = await api.get<{ draft: Draft | null }>(day("/draft"));
    const proposed = await api.post<{ draft: Draft }>(day("/propose"), { revision: current.draft?.revision ?? 0 });
    const data: DraftData = {
      ...proposed.draft.data,
      trips: proposed.draft.data.trips.map((trip) => ({
        ...trip,
        orderIds: trip.orderIds.filter((id) => id !== order.id),
      })),
      unassignedOrderIds: proposed.draft.data.unassignedOrderIds.filter((id) => id !== order.id),
      deferrals: [
        ...proposed.draft.data.deferrals.filter((deferral) => deferral.orderId !== order.id),
        { orderId: order.id, reasonCode: "MOVED_BY_POLICY", note: "Walkthrough: moved by the dispatcher" },
      ],
    };
    const saved = await api.put<{ draft: Draft }>(day("/draft"), { revision: proposed.draft.revision, data });
    await api.post(day("/publish"), { revision: saved.draft.revision });
  } finally {
    await api.dispose();
  }
}
