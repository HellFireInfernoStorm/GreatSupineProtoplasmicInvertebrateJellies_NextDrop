import { apiFixtures, createOrderRequestSchema, type ApiDtoInput, type ApiRouteName } from "@nextdrop/contracts";
import {
  addDays,
  calendarDay,
  colomboLocal,
  cutoffAt,
  dayNumber,
  deliveryDateFor,
  nextOperatingDate,
  orderingGuidance,
} from "@nextdrop/rules";
import { MOCK_CALENDAR } from "./mockCalendar";
import type { RawResponse, TransportRequest } from "./types";

// Mock answers for the Store flow (VITE_API_MOCK=true). The contract fixtures hold one product and one order, which is
// not enough to build or show an ordering screen, so this module answers the reference and store-order routes with a
// small Fresh catalogue and keeps the orders placed in this tab. Dates and the cutoff come from packages/rules, so the
// mock behaves like the server: Monday to Saturday, cutoff at 16:00 the day before.

type Product = ApiDtoInput<"product">;
type Order = ApiDtoInput<"order">;

export const MOCK_OUTLET = apiFixtures.outletsResponse.items[0]!;
const outlet = MOCK_OUTLET;
/** No rows: every date falls back to the default Monday-to-Saturday calendar. */
const calendar = new Map<string, never>();

export const mockId = (n: number) => `018f1234-5678-7890-abcd-ef12345670${String(n).padStart(2, "0")}`;

const product = (
  n: number,
  sku: string,
  name: string,
  unitLabel: string,
  tempRequirement: Product["tempRequirement"],
  unitWeightG: number,
  unitVolumeM3: number,
): Product => ({
  id: mockId(n),
  sku,
  name,
  brand: outlet.brand,
  tempRequirement,
  unitLabel,
  unitWeightG,
  unitVolumeM3,
});

export const MOCK_PRODUCTS: readonly Product[] = [
  product(1, "FD-101", "Rice 5 kg", "bag", "ambient", 5000, 0.007),
  product(2, "FD-114", "Pasta 500 g", "case", "ambient", 6000, 0.02),
  product(3, "FD-122", "Red dhal 1 kg", "bag", "ambient", 1000, 0.0015),
  product(4, "FD-130", "White sugar 1 kg", "bag", "ambient", 1000, 0.0012),
  product(5, "FD-146", "Tea 400 g", "case", "ambient", 4800, 0.018),
  product(6, "FD-151", "Wheat flour 1 kg", "bag", "ambient", 1000, 0.0016),
  product(11, "FC-201", "Full cream milk 1 L", "crate", "chilled", 12500, 0.025),
  product(12, "FC-207", "Eggs 10-pack", "crate", "chilled", 7000, 0.03),
  product(13, "FC-212", "Yoghurt 80 g", "tray", "chilled", 2200, 0.006),
  product(14, "FC-220", "Butter 200 g", "case", "chilled", 4200, 0.008),
];

/** What the outlet ordered a week ago, by SKU: the source of "Repeat last week". */
const LAST_WEEK: Readonly<Record<string, number>> = {
  "FD-101": 10,
  "FD-114": 20,
  "FD-122": 6,
  "FD-130": 8,
  "FD-146": 2,
  "FC-201": 24,
  "FC-207": 8,
};

const placed: Order[] = [];
const byIdempotencyKey = new Map<string, Order>();
let nextDisplayNumber = 10475;

export function buildOrder(
  n: number,
  displayId: string,
  requestedDate: string,
  lines: readonly { productId: string; qty: number }[],
  nowMs: number,
): Order {
  const picked = lines.map((line) => ({ line, product: MOCK_PRODUCTS.find((p) => p.id === line.productId)! }));
  return {
    ...apiFixtures.order,
    id: mockId(n),
    displayId,
    outletId: outlet.id,
    brand: outlet.brand,
    tempRequirement: picked[0]!.product.tempRequirement,
    requestedDate,
    currentDate: deliveryDateFor(requestedDate, nowMs, calendar),
    status: "ORDERED",
    weightG: picked.reduce((sum, { line, product }) => sum + line.qty * product.unitWeightG, 0),
    volumeL: Math.round(picked.reduce((sum, { line, product }) => sum + line.qty * product.unitVolumeM3 * 1000, 0)),
    placedAt: new Date(nowMs).toISOString(),
    confirmedAt: null,
    deferredCount: 0,
    lines: picked.map(({ line, product }, index) => ({
      id: `line-${index + 1}`,
      productId: product.id,
      sku: product.sku,
      name: product.name,
      unitLabel: product.unitLabel,
      qtyOrdered: line.qty,
      qtyLoaded: 0,
      qtyDelivered: 0,
      qtyReceived: 0,
      unitWeightG: product.unitWeightG,
      unitVolumeM3: product.unitVolumeM3,
    })),
    flags: { short: [], damaged: [] },
    assignment: null,
    deferral: null,
  };
}

function lastWeekOrders(date: string, nowMs: number): Order[] {
  return (["ambient", "chilled"] as const).flatMap((temp, index) => {
    const lines = MOCK_PRODUCTS.filter((p) => p.tempRequirement === temp && LAST_WEEK[p.sku]).map((p) => ({
      productId: p.id,
      qty: LAST_WEEK[p.sku]!,
    }));
    if (lines.length === 0) return [];
    const order = buildOrder(80 + index, `ORD1040${index + 1}`, date, lines, nowMs);
    return [
      {
        ...order,
        currentDate: date,
        status: "RECEIVED" as const,
        placedAt: new Date(cutoffAt(date) - 3 * 3600_000).toISOString(),
      },
    ];
  });
}

const validationFailed = (reason: string): RawResponse => ({
  status: 422,
  body: {
    ...apiFixtures.apiError,
    code: "VALIDATION_FAILED",
    message_key: "errors.validation_failed",
    params: { reason },
  },
});

/** Answers the reference and store-order routes, or null to leave the route to the contract fixtures. */
export function mockStoreRespond(
  request: Pick<TransportRequest, "name" | "url" | "body" | "headers">,
  nowMs: number,
): RawResponse | null {
  const query = new URL(request.url, "http://mock.local").searchParams;
  const serverTime = new Date(nowMs).toISOString();
  const name: ApiRouteName = request.name;
  switch (name) {
    case "outlets":
      return { status: 200, body: { items: [outlet] } };
    case "products":
      return { status: 200, body: { items: MOCK_PRODUCTS } };
    case "calendar": {
      const from = query.get("from");
      const to = query.get("to");
      if (!from || !to) return null;
      const days = Math.min(Math.max(dayNumber(to) - dayNumber(from), 0), 60);
      // Paydays and festivals are marked for the dispatcher's outlook; operating days are those of `calendar`.
      const items = Array.from({ length: days + 1 }, (_, i) => calendarDay(addDays(from, i), MOCK_CALENDAR));
      return { status: 200, body: { items } };
    }
    case "storeCutoff": {
      const requested = query.get("date");
      if (!requested) return null;
      const deliveryDate = deliveryDateFor(requested, nowMs, calendar);
      return {
        status: 200,
        body: {
          serverTime,
          requestedDate: requested,
          deliveryDate,
          cutoffAt: new Date(cutoffAt(deliveryDate)).toISOString(),
          orderingOpen: deliveryDate === nextOperatingDate(requested, calendar),
          guidanceKey: orderingGuidance(outlet.brand, requested, calendar),
        },
      };
    }
    case "storeOrders": {
      const date = query.get("date");
      const today = colomboLocal(nowMs).date;
      const items =
        date === null
          ? placed
          : date < today
            ? lastWeekOrders(date, nowMs)
            : placed.filter((o) => o.requestedDate === date);
      return { status: 200, body: { items, nextCursor: null } };
    }
    case "createOrder": {
      const parsed = createOrderRequestSchema.safeParse(request.body);
      if (!parsed.success) return validationFailed("body");
      const key = request.headers["idempotency-key"] ?? "";
      const existing = byIdempotencyKey.get(key);
      if (existing) return { status: 201, body: existing };
      const products = parsed.data.lines.map((line) => MOCK_PRODUCTS.find((p) => p.id === line.productId));
      if (products.some((p) => p === undefined)) return validationFailed("unknown_product");
      if (new Set(products.map((p) => p!.tempRequirement)).size > 1) return validationFailed("mixed_temperature");
      const order = buildOrder(
        20 + placed.length,
        `ORD${nextDisplayNumber++}`,
        parsed.data.requestedDate,
        parsed.data.lines,
        nowMs,
      );
      placed.push(order);
      if (key) byIdempotencyKey.set(key, order);
      return { status: 201, body: order };
    }
    default:
      return null;
  }
}
