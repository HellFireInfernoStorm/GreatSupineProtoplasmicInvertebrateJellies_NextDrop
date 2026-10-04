import { apiFixtures, type ApiDtoInput, type ApiRouteName } from "@nextdrop/contracts";
import { addDays, colomboLocal } from "@nextdrop/rules";
import { readStored, writeStored } from "../storage";
import { buildOrder, MOCK_OUTLET, MOCK_PRODUCTS, mockId } from "./mockStore";
import type { RawResponse, TransportRequest } from "./types";

// The Store's delivery story for mock mode (VITE_API_MOCK=true), after the Figma "day at OUT015": a chilled order that
// was deferred once and is four crates short at the dock, and a dry order coming in full, both on trip T001.
//
// The story has four moments. Open any Store page with `?mock=<moment>` to switch; the choice lasts for the tab.
//   onway      both orders out for delivery, the driver in contact (the default)
//   nosignal   the same, but the driver has been silent for half an hour
//   delivered  the driver's record has arrived: delivered earlier, confirmed after sync
//   evening    today's orders received or disputed; tomorrow has one planned order and one deferred
// Times are set around the current moment, so the screens always look live.

export const MOCK_MOMENTS = ["onway", "nosignal", "delivered", "evening"] as const;
export type MockMoment = (typeof MOCK_MOMENTS)[number];

type Order = ApiDtoInput<"order">;
type Delivery = ApiDtoInput<"deliveriesResponse">["items"][number];

const MOMENT_KEY = "nextdrop.mock.store";
const MIN = 60_000;

const isMoment = (value: string | null): value is MockMoment => MOCK_MOMENTS.some((moment) => moment === value);

function moment(): MockMoment {
  let asked: string | null = null;
  try {
    asked = new URLSearchParams(window.location.search).get("mock");
  } catch {
    // No window (tests): the default moment.
  }
  if (isMoment(asked) && asked !== readStored(MOMENT_KEY, "session")) {
    // A new moment starts the story again.
    changed.clear();
    writeStored(CHANGED_KEY, null, "session");
    writeStored(MOMENT_KEY, asked, "session");
  }
  const stored = readStored(MOMENT_KEY, "session");
  return isMoment(stored) ? stored : "onway";
}

/** What the manager did in this tab: receipts confirmed and issues reported, by order ID. */
type Change = Pick<Order, "status"> & { received?: Readonly<Record<string, number>> };
const CHANGED_KEY = "nextdrop.mock.store.changed";

function readChanged(): Map<string, Change> {
  try {
    return new Map(Object.entries(JSON.parse(readStored(CHANGED_KEY, "session") ?? "{}") as Record<string, Change>));
  } catch {
    return new Map();
  }
}
// Kept for the tab, like the mock session, so a reload does not undo a receipt.
const changed = readChanged();
function remember(orderId: string, change: Change): void {
  changed.set(orderId, change);
  writeStored(CHANGED_KEY, JSON.stringify(Object.fromEntries(changed)), "session");
}

const iso = (ms: number) => new Date(ms).toISOString();
/** Rounded to five minutes, as an ETA band is. */
const five = (ms: number) => Math.round(ms / (5 * MIN)) * 5 * MIN;
const productId = (sku: string) => MOCK_PRODUCTS.find((p) => p.sku === sku)!.id;

const CHILLED = [
  { productId: productId("FC-201"), qty: 12 },
  { productId: productId("FC-207"), qty: 8 },
];
const DRY = [
  { productId: productId("FD-114"), qty: 10 },
  { productId: productId("FD-146"), qty: 8 },
];
/** Milk crates short at the dock, on the chilled order's first line. */
const SHORT = 4;

const TRIP_ID = mockId(60);
const NEXT_TRIP_ID = mockId(61);

function withProgress(order: Order, status: Order["status"], short: number): Order {
  const loaded = status !== "ORDERED" && status !== "PLANNED" && status !== "DEFERRED";
  const delivered = status === "DELIVERED" || status === "RECEIVED" || status === "DISPUTED";
  const done = changed.get(order.id);
  return {
    ...order,
    status: done?.status ?? status,
    confirmedAt: order.placedAt,
    lines: order.lines.map((line, index) => {
      const sent = line.qtyOrdered - (index === 0 ? short : 0);
      return {
        ...line,
        qtyLoaded: loaded ? sent : 0,
        qtyDelivered: delivered ? sent : 0,
        qtyReceived: done?.received?.[line.id] ?? (status === "RECEIVED" || status === "DISPUTED" ? sent : 0),
      };
    }),
    flags: {
      short: short > 0 ? [{ lineId: order.lines[0]!.id, qtyShort: short, resolution: "SHIP_PARTIAL" }] : [],
      damaged: [],
    },
  };
}

function story(nowMs: number): { today: Delivery[]; tomorrow: Delivery[] } {
  const at = moment();
  const today = colomboLocal(nowMs).date;
  const tomorrow = addDays(today, 1);
  const placedAt = iso(nowMs - 20 * 60 * MIN);

  const delivered = at === "delivered" || at === "evening";
  const deliveredAt = nowMs - (at === "evening" ? 5 * 60 : 88) * MIN;
  const etaFrom = delivered ? five(deliveredAt - 10 * MIN) : five(nowMs + 25 * MIN);
  const eta = { etaFrom: iso(etaFrom), etaTo: iso(etaFrom + 30 * MIN) };
  const assignment = { tripId: TRIP_ID, vehicleId: apiFixtures.trip.vehicleId, seq: 4, ...eta };

  const base = (n: number, displayId: string, date: string, lines: typeof DRY): Order => ({
    ...buildOrder(n, displayId, date, lines, nowMs),
    requestedDate: date,
    currentDate: date,
    placedAt,
  });

  const chilled: Order = {
    ...withProgress(
      base(41, "ORD10412", today, CHILLED),
      at === "evening" ? "DISPUTED" : delivered ? "DELIVERED" : "OUT_FOR_DELIVERY",
      SHORT,
    ),
    requestedDate: addDays(today, -1),
    deferredCount: 1,
    deferral: {
      reasonCode: "REEFER_SHORTAGE",
      causeKind: "UNAVOIDABLE_POOL_EXHAUSTED",
      scoreInputs: null,
      toDate: today,
      daysUnserved: 1,
      consecutiveDeferrals: 1,
      note: "",
      decidedBy: "DISPATCHER",
    },
    assignment,
  };
  const dry: Order = {
    ...withProgress(
      base(42, "ORD10468", today, DRY),
      at === "evening" ? "RECEIVED" : delivered ? "DELIVERED" : "OUT_FOR_DELIVERY",
      0,
    ),
    assignment,
  };

  const stop = (n: number, order: Order) => {
    // Only an order the driver has handed over has delivery times.
    const done = order.status === "DELIVERED" || order.status === "RECEIVED" || order.status === "DISPUTED";
    return {
      ...apiFixtures.trip.stops[0]!,
      id: mockId(n),
      seq: order.assignment?.seq ?? 1,
      order,
      outlet: MOCK_OUTLET,
      etaFrom: order.assignment?.etaFrom ?? eta.etaFrom,
      etaTo: order.assignment?.etaTo ?? eta.etaTo,
      arrivedAt: done ? iso(deliveredAt - 6 * MIN) : null,
      // Delivered on the driver's phone, confirmed when the phone reached the server: two times, never merged.
      deliveredAt: done ? iso(deliveredAt) : null,
      confirmedAt: done ? iso(deliveredAt + 84 * MIN) : null,
    };
  };
  const trip = (
    n: number,
    displayId: string,
    orders: readonly Order[],
    status: "PLANNED" | "DEPARTED" | "COMPLETE",
    departMs: number,
  ) => ({
    ...apiFixtures.trip,
    id: mockId(n),
    displayId,
    brand: MOCK_OUTLET.brand,
    district: MOCK_OUTLET.district,
    status,
    plannedDepart: iso(departMs),
    stops: orders.map((order, index) => stop(n + 10 + index, order)),
  });

  const silent = at === "nosignal";
  const todayTrip = trip(60, "T001", [chilled, dry], at === "evening" ? "COMPLETE" : "DEPARTED", etaFrom - 150 * MIN);
  const contact = {
    signal: silent ? "NO_SIGNAL" : "ONLINE",
    lastHeardAt: iso(nowMs - (silent ? 32 : 3) * MIN),
  } as const;
  const todayItems: Delivery[] = [chilled, dry].map((order) => ({ order, trip: todayTrip, ...contact }));

  if (at !== "evening") return { today: todayItems, tomorrow: [] };

  // Tomorrow: the chilled order is planned, the dry order was deferred to the day after.
  const nextEta = five(nowMs + 9 * 60 * MIN);
  const nextAssignment = {
    tripId: NEXT_TRIP_ID,
    vehicleId: apiFixtures.trip.vehicleId,
    seq: 2,
    etaFrom: iso(nextEta),
    etaTo: iso(nextEta + 30 * MIN),
  };
  const planned: Order = {
    ...withProgress(base(43, "ORD10476", tomorrow, CHILLED), "PLANNED", 0),
    assignment: nextAssignment,
  };
  const deferred: Order = {
    ...withProgress(base(44, "ORD10475", tomorrow, DRY), "DEFERRED", 0),
    currentDate: addDays(tomorrow, 1),
    deferredCount: 1,
    deferral: {
      reasonCode: "CAPACITY_VOLUME",
      causeKind: "CHOICE",
      scoreInputs: null,
      toDate: addDays(tomorrow, 1),
      daysUnserved: 1,
      consecutiveDeferrals: 1,
      note: "",
      decidedBy: "DISPATCHER",
    },
  };
  const nextTrip = trip(61, "T003", [planned], "PLANNED", nextEta - 150 * MIN);
  return {
    today: todayItems,
    tomorrow: [
      { order: planned, trip: nextTrip, signal: "ONLINE", lastHeardAt: null },
      { order: deferred, trip: null, signal: "ONLINE", lastHeardAt: null },
    ],
  };
}

type TimelineEvent = ApiDtoInput<"orderDetail">["timeline"][number];

/** The events behind an order's status, in the order they happened: what its timeline shows. */
function timelineOf(delivery: Delivery): TimelineEvent[] {
  const { order, trip } = delivery;
  const n = order.id.slice(-2);
  const events: TimelineEvent[] = [];
  const add = (
    role: TimelineEvent["actor"]["role"],
    capturedMs: number,
    event: Pick<TimelineEvent, "type" | "payload">,
    receivedMs: number = capturedMs,
  ) => {
    events.push({
      id: `018f1234-5678-7890-abcd-ef123450${n}${String(events.length).padStart(2, "0")}`,
      schemaVersion: 1,
      subject: { orderId: order.id },
      source: receivedMs === capturedMs ? "SERVER" : "FIELD",
      actor: { userId: `mock-${role.toLowerCase()}`, role },
      capturedAt: iso(capturedMs),
      receivedAt: iso(receivedMs),
      disposition: "APPLIED",
      ...event,
    } as TimelineEvent);
  };
  const placedMs = Date.parse(order.placedAt);
  add("STORE", placedMs, {
    type: "ORDER_PLACED",
    payload: {
      lines: order.lines.map((line) => ({ lineId: line.id, skuId: line.sku, qty: line.qtyOrdered })),
      requestedDate: order.requestedDate,
    },
  });
  if (order.deferral) add("DISPATCHER", placedMs + 90 * MIN, { type: "ORDER_DEFERRED", payload: order.deferral });
  if (!order.assignment || !trip) return events;

  const etaMs = Date.parse(order.assignment.etaFrom);
  add("DISPATCHER", Math.max(placedMs + 120 * MIN, etaMs - 9 * 60 * MIN), {
    type: "ORDER_PLANNED",
    payload: { ...order.assignment, planVersion: 1 },
  });
  if (order.status === "PLANNED") return events;
  if (order.flags.short.length > 0) {
    add("LOADER", etaMs - 190 * MIN, {
      type: "LOAD_SHORT",
      payload: {
        lines: order.flags.short.map((flag) => ({ lineId: flag.lineId, qtyShort: flag.qtyShort })),
        reasonCode: "OUT_OF_STOCK",
      },
    });
  }
  add("LOADER", etaMs - 170 * MIN, {
    type: "LOAD_CONFIRMED",
    payload: { lines: order.lines.map((line) => ({ lineId: line.id, qtyLoaded: line.qtyLoaded })) },
  });
  add("DRIVER", etaMs - 150 * MIN, { type: "ORDER_OUT_FOR_DELIVERY", payload: { tripId: trip.id } });

  const stop = trip.stops.find((candidate) => candidate.order.id === order.id);
  if (!stop?.deliveredAt || !stop.confirmedAt) return events;
  // Recorded on the driver's phone while it was out of coverage, received when it synced.
  const deliveredMs = Date.parse(stop.deliveredAt);
  const syncedMs = Date.parse(stop.confirmedAt);
  add(
    "DRIVER",
    deliveredMs,
    {
      type: "STOP_OUTCOME",
      payload: {
        outcome: order.flags.short.length > 0 ? "PARTIAL" : "FULL",
        lines: order.lines.map((line) => ({ lineId: line.id, qtyDelivered: line.qtyDelivered })),
      },
    },
    syncedMs,
  );
  add(
    "DRIVER",
    deliveredMs + MIN,
    { type: "POD_CAPTURED", payload: { receiverName: "Dilini", photoBlobRefs: ["mock-photo"] } },
    syncedMs,
  );
  if (order.status === "RECEIVED") {
    add("STORE", syncedMs + 4 * MIN, {
      type: "RECEIPT_CONFIRMED",
      payload: { lines: order.lines.map((line) => ({ lineId: line.id, qtyReceived: line.qtyReceived })) },
    });
  }
  if (order.status === "DISPUTED") {
    add("STORE", syncedMs + 6 * MIN, {
      type: "ISSUE_REPORTED",
      payload: { kind: "WARM", lines: [{ lineId: order.lines[0]!.id, qty: 1 }], note: "One crate arrived warm." },
    });
  }
  return events;
}

const notFound = (): RawResponse => ({
  status: 404,
  body: { ...apiFixtures.apiError, code: "NOT_FOUND", message_key: "errors.not_found", params: {} },
});

/** Answers the Store's delivery routes, or null to leave the route to the other mock answers. */
export function mockDeliveriesRespond(
  request: Pick<TransportRequest, "name" | "url" | "body">,
  nowMs: number,
): RawResponse | null {
  const url = new URL(request.url, "http://mock.local");
  const name: ApiRouteName = request.name;
  const { today, tomorrow } = story(nowMs);
  const all = [...today, ...tomorrow];
  const itemByPath = () => all.find((item) => url.pathname.split("/").includes(item.order.id));
  const byPath = () => itemByPath()?.order;
  switch (name) {
    case "storeDeliveries": {
      const date = url.searchParams.get("date");
      // A deferred order is listed on the day it moved to, as the server lists it by its current date.
      return {
        status: 200,
        body: { items: all.filter((item) => item.order.currentDate === date), serverTime: iso(nowMs) },
      };
    }
    case "storeOrders": {
      // Past dates stay with the place-order mock: they are "last week's order".
      const date = url.searchParams.get("date");
      const status = url.searchParams.get("status");
      if (date !== null && date < colomboLocal(nowMs).date) return null;
      if (date === null && status === null) return null;
      const items = all
        .map((item) => item.order)
        .filter(
          (order) => (date === null || order.currentDate === date) && (status === null || order.status === status),
        );
      return items.length === 0 ? null : { status: 200, body: { items, nextCursor: null } };
    }
    case "storeOrder": {
      const item = itemByPath();
      return item ? { status: 200, body: { order: item.order, timeline: timelineOf(item) } } : null;
    }
    case "receipt": {
      const order = byPath();
      if (!order) return notFound();
      const body = request.body as ApiDtoInput<"receiptRequest">;
      const received = Object.fromEntries(body.lines.map((line) => [line.lineId, line.qtyReceived]));
      remember(order.id, { status: "RECEIVED", received });
      return { status: 200, body: story(nowMs).today.find((item) => item.order.id === order.id)?.order ?? order };
    }
    case "reportIssue": {
      const order = byPath();
      if (!order) return notFound();
      remember(order.id, { ...changed.get(order.id), status: "DISPUTED" });
      return { status: 201, body: { issueId: mockId(90), order: { ...order, status: "DISPUTED" } } };
    }
    default:
      return null;
  }
}
