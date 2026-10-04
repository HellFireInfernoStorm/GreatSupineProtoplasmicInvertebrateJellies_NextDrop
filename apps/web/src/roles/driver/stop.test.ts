import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, it, vi } from "vitest";
import { apiVariantFixtures, type FieldSnapshot } from "@nextdrop/contracts";
import { uuidv7 } from "uuidv7";
import { OfflineDatabase, type FieldReceipt } from "../../sync/database";
import { FieldRepository } from "../../sync/repository";
import { useDriverData } from "./data";
import { deliveryIntents } from "./model";
import { StopPage } from "./Stop";
import type * as DriverParts from "./parts";
import "../../i18n";

vi.mock("./data", () => ({ useDriverData: vi.fn() }));
vi.mock("../../lib/session", () => ({ useSession: () => ({ user: { id: "driver-1" } }) }));
vi.mock("../../sync/controller", () => ({ useSyncActivity: () => ({ offline: false, syncing: false }) }));
vi.mock("./parts", async (importOriginal) => ({
  ...(await importOriginal<typeof DriverParts>()),
  Frame: ({ children, footer }: { children: ReactNode; footer?: ReactNode }) =>
    createElement("main", null, children, footer),
}));

it("keeps this phone's saved proof status visible after a terminal covering snapshot", async () => {
  const snapshot: FieldSnapshot = structuredClone(apiVariantFixtures.fieldSnapshot.DRIVER);
  const trip = snapshot.scope.trips[0]!;
  const stop = trip.stops[0]!;
  const db = new OfflineDatabase(`stop-screen-${uuidv7()}`);
  try {
    const repository = new FieldRepository(db);
    await db.set("deviceId", uuidv7());
    await repository.replaceSnapshot(snapshot, "driver-1");
    const photo = uuidv7();
    const receipt: Omit<FieldReceipt, "events"> = {
      id: "delivery",
      userId: "driver-1",
      resetEpoch: snapshot.resetEpoch,
      date: snapshot.scope.date,
      tripId: trip.id,
      orderId: stop.order.id,
      kind: "DELIVERY",
      planVersion: snapshot.planVersion!,
    };
    const events = await repository.enqueueBatch(
      deliveryIntents({
        stop,
        trip,
        userId: "driver-1",
        outcome: "FULL",
        quantities: {},
        reason: "",
        receiver: "Nimal",
        photos: [photo],
      }),
      receipt,
    );
    stop.order.status = "DELIVERED";
    const data: ReturnType<typeof useDriverData> = {
      snapshot,
      events: [],
      receipts: [
        {
          ...receipt,
          events: events.map((event) => ({
            ...event,
            state: "acked",
            confirmedAt: snapshot.serverTime,
            confirmationFeedHead: snapshot.feedCursor,
          })),
        },
      ],
      blobs: [
        { clientBlobId: photo, userId: "driver-1", bytes: new Blob(), state: "pending", attempts: 0, lastError: null },
      ],
      conflicts: [],
      baseline: snapshot.planVersion!,
      loaded: true,
    };
    const render = () => {
      vi.mocked(useDriverData).mockReturnValue(data);
      return renderToStaticMarkup(
        createElement(
          MemoryRouter,
          { initialEntries: [`/driver/stop/${stop.id}`] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/driver/stop/:stopId", element: createElement(StopPage) }),
          ),
        ),
      );
    };
    expect(render()).toContain("Saved on this phone");
    expect(render()).not.toContain("This stop already has a recorded outcome.");
    expect(render()).not.toContain("All records and photos have server confirmation.");
    data.blobs[0]!.state = "acked";
    expect(render()).toContain("All records and photos have server confirmation.");
    data.receipts = [];
    expect(render()).toContain("This stop already has a recorded outcome.");
    expect(render()).not.toContain("Save delivery");
  } finally {
    await db.delete();
  }
});
