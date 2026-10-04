import { DEPOTS } from "./accounts";
import { ApiSession } from "./api";
import { STORY } from "./demo";

// Stand-ins for walkthrough steps whose screens are not merged yet (issue #62, delivery in stages).
//
// A later step can only run if the earlier ones happened. While an earlier step is still `test.fixme`, the stand-in
// here does through the API what that step will do through the screen, so the later step can already be a real one.
// Each stand-in names the step it replaces. Delete it in the PR that turns that step into a real one.

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
 * Stands in for step 5 (dispatcher D3, issue #49): on the Peliyagoda draft the dispatcher saved in steps 3 and 4,
 * record one order as deferred by the dispatcher's choice, and publish. Step 6 needs a store with one planned and
 * one deferred order.
 */
export async function publishDraftDeferring(baseURL: string, orderDisplayId: string): Promise<void> {
  const api = await ApiSession.dispatcher(baseURL, DEPOTS.peliyagoda);
  try {
    const { queue } = await api.get<{ queue: { id: string; displayId: string }[] }>(day());
    const order = queue.find((candidate) => candidate.displayId === orderDisplayId);
    if (!order) throw new Error(`${orderDisplayId} is not in the ${DEPOTS.peliyagoda} queue for ${STORY.deliveryDay}`);

    const { draft } = await api.get<{ draft: Draft | null }>(day("/draft"));
    if (!draft) throw new Error(`No draft for ${DEPOTS.peliyagoda} on ${STORY.deliveryDay}: step 3 proposes it`);
    const data: DraftData = {
      trips: draft.data.trips.map((trip) => ({ ...trip, orderIds: trip.orderIds.filter((id) => id !== order.id) })),
      unassignedOrderIds: draft.data.unassignedOrderIds.filter((id) => id !== order.id),
      deferrals: [
        ...draft.data.deferrals.filter((deferral) => deferral.orderId !== order.id),
        { orderId: order.id, reasonCode: "MOVED_BY_POLICY", note: "Walkthrough: moved by the dispatcher" },
      ],
    };
    const saved = await api.put<{ draft: Draft }>(day("/draft"), { revision: draft.revision, data });
    await api.post(day("/publish"), { revision: saved.draft.revision });
  } finally {
    await api.dispose();
  }
}
