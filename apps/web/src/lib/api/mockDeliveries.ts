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
  if (isMoment(asked)) writeStored(MOMENT_KEY, asked, "session");
  const stored = readStored(MOMENT_KEY, "session");
  return isMoment(stored) ? stored : "onway";
}

/** What the manager did in this tab: receipts confirmed and issues reported, by order ID. */
const changed = new Map<string, Pick<Order, "status"> & { received?: Readonly<Record<string, number>> }>();

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

  const stop = (n: number, order: Order) => ({
    ...apiFixtures.trip.stops[0]!,
    id: mockId(n),
    seq: 4,
    order,
    outlet: MOCK_OUTLET,
    ...eta,
    arrivedAt: delivered ? iso(deliveredAt - 6 * MIN) : null,
    // Delivered on the driver's phone, confirmed when the phone reached the server: two times, never merged.
    deliveredAt: delivered ? iso(deliveredAt) : null,
    confirmedAt: delivered ? iso(deliveredAt + 84 * MIN) : null,
  });
  const trip = (orders: readonly Order[], status: "PLANNED" | "DEPARTED" | "COMPLETE", departMs: number) => ({
    ...apiFixtures.trip,
    id: TRIP_ID,
    displayId: "T001",
    brand: MOCK_OUTLET.brand,
    district: MOCK_OUTLET.district,
    status,
    plannedDepart: iso(departMs),
    stops: orders.map((order, index) => stop(70 + index, order)),
  });

  const silent = at === "nosignal";
  const todayTrip = trip([chilled, dry], at === "evening" ? "COMPLETE" : "DEPARTED", etaFrom - 150 * MIN);
  const contact = {
    signal: silent ? "NO_SIGNAL" : "ONLINE",
    lastHeardAt: iso(nowMs - (silent ? 32 : 3) * MIN),
  } as const;
  const todayItems: Delivery[] = [chilled, dry].map((order) => ({ order, trip: todayTrip, ...contact }));

  if (at !== "evening") return { today: todayItems, tomorrow: [] };

  // Tomorrow: the chilled order is planned, the dry order was deferred to the day after.
  const nextEta = five(nowMs + 9 * 60 * MIN);
  const nextAssignment = {
    tripId: TRIP_ID,
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
  const nextTrip = trip([planned], "PLANNED", nextEta - 150 * MIN);
  return {
    today: todayItems,
    tomorrow: [
      { order: planned, trip: nextTrip, signal: "ONLINE", lastHeardAt: null },
      { order: deferred, trip: null, signal: "ONLINE", lastHeardAt: null },
    ],
  };
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
  const byPath = () => all.find((item) => url.pathname.split("/").includes(item.order.id))?.order;
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
      const order = byPath();
      return order ? { status: 200, body: { order, timeline: [] } } : null;
    }
    case "receipt": {
      const order = byPath();
      if (!order) return notFound();
      const body = request.body as ApiDtoInput<"receiptRequest">;
      const received = Object.fromEntries(body.lines.map((line) => [line.lineId, line.qtyReceived]));
      changed.set(order.id, { status: "RECEIVED", received });
      return { status: 200, body: story(nowMs).today.find((item) => item.order.id === order.id)?.order ?? order };
    }
    case "reportIssue": {
      const order = byPath();
      if (!order) return notFound();
      changed.set(order.id, { ...changed.get(order.id), status: "DISPUTED" });
      return { status: 201, body: { issueId: mockId(90), order: { ...order, status: "DISPUTED" } } };
    }
    default:
      return null;
  }
}
