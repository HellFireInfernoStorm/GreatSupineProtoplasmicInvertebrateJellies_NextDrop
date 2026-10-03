import { DEFAULT_RULES_CONFIG } from "@nextdrop/rules";
import type { ApiDtoInput } from "./schemas";

export const MOCK_ID = "018f1234-5678-7890-abcd-ef1234567890";
export const MOCK_ORDER_ID = "018f1234-5678-7890-abcd-ef1234567891";
export const MOCK_VEHICLE_ID = "018f1234-5678-7890-abcd-ef1234567892";
export const MOCK_TIME = "2026-10-03T05:00:00.000Z";
export const MOCK_DATE = "2026-10-03";
const contact = { name: "Mock contact", phone: "+94770000000" };
const window = { open: 210, close: 480 };
const outlet = {
  id: MOCK_ID,
  displayId: "OUT015",
  name: "Waypoint Fresh, Colombo",
  brand: "Fresh",
  district: "Colombo",
  depot: "Peliyagoda",
  dockType: "rear_dock",
  parking: "normal",
  mallWindow: null,
  window,
  address: null,
  contact: null,
} satisfies ApiDtoInput<"outlet">;
const vehicle = {
  id: MOCK_VEHICLE_ID,
  displayId: "VEH001",
  type: "truck",
  temp: "reefer",
  weightCapG: 5000000,
  volumeCapL: 12000,
  fuelType: "diesel",
  metresPerLitre: 5000,
  weeklyFuelQuotaMl: 200000,
  depot: "Peliyagoda",
  driver: contact,
} satisfies ApiDtoInput<"vehicle">;
const product = {
  id: MOCK_ID,
  sku: "MOCK-FRESH-01",
  name: "Mock fresh product",
  brand: "Fresh",
  tempRequirement: "chilled",
  unitLabel: "crate",
  unitWeightG: 5000,
  unitVolumeM3: 0.02,
} satisfies ApiDtoInput<"product">;
const orderLine = {
  id: "line-1",
  productId: MOCK_ID,
  sku: product.sku,
  name: product.name,
  unitLabel: "crate",
  qtyOrdered: 2,
  qtyLoaded: 2,
  qtyDelivered: 0,
  qtyReceived: 0,
  unitWeightG: 5000,
  unitVolumeM3: 0.02,
};
const order = {
  id: MOCK_ORDER_ID,
  displayId: "ORD10412",
  outletId: MOCK_ID,
  brand: "Fresh",
  tempRequirement: "chilled",
  requestedDate: MOCK_DATE,
  currentDate: MOCK_DATE,
  status: "PLANNED",
  weightG: 10000,
  volumeL: 40,
  placedAt: "2026-10-02T05:00:00.000Z",
  confirmedAt: "2026-10-02T05:00:01.000Z",
  deferredCount: 0,
  replacesOrderId: null,
  lines: [orderLine],
  flags: { short: [], damaged: [] },
  assignment: {
    tripId: MOCK_ID,
    vehicleId: MOCK_VEHICLE_ID,
    seq: 1,
    etaFrom: MOCK_TIME,
    etaTo: "2026-10-03T05:30:00.000Z",
  },
  deferral: null,
} satisfies ApiDtoInput<"order">;
const stop = {
  id: MOCK_ID,
  seq: 1,
  order,
  outlet,
  etaFrom: MOCK_TIME,
  etaTo: "2026-10-03T05:30:00.000Z",
  window,
  serviceMin: 15,
  arrivedAt: null,
  deliveredAt: null,
  confirmedAt: null,
} satisfies ApiDtoInput<"stop">;
const trip = {
  id: MOCK_ID,
  displayId: "T015",
  vehicleId: MOCK_VEHICLE_ID,
  tripNo: 1,
  brand: "Fresh",
  district: "Colombo",
  status: "PLANNED",
  plannedDepart: "2026-10-02T22:00:00.000Z",
  plannedMinutes: 101,
  distanceM: 30000,
  fuelMl: 6000,
  stops: [stop],
} satisfies ApiDtoInput<"trip">;
const deferral = {
  orderId: MOCK_ORDER_ID,
  reasonCode: "TIME_BUDGET",
  causeKind: "UNAVOIDABLE_POOL_EXHAUSTED",
  bindingConstraint: "TIME_BUDGET_EXCEEDED",
  scoreInputs: {
    priorityClass: "OTHER_FRESH",
    aged: false,
    deferredYesterday: false,
    daysSinceLastServed: 1,
    deferredCount: 0,
    slip: 0,
    volumeL: 40,
  },
  displacedBy: [MOCK_ID],
  note: "Time budget exhausted",
  nextServiceableDate: "2026-10-04",
  daysUnserved: 1,
  consecutiveDeferrals: 1,
} satisfies ApiDtoInput<"deferral">;
const draftTrip = {
  ref: "T015",
  vehicleId: MOCK_VEHICLE_ID,
  tripNo: 1,
  orderIds: [MOCK_ORDER_ID],
} satisfies ApiDtoInput<"draftTrip">;
const draftData = { trips: [draftTrip], unassignedOrderIds: [], deferrals: [] };
const draft = { revision: 1, baseVersion: null, data: draftData, updatedAt: MOCK_TIME };
const planVersion = {
  version: 1,
  publishedAt: MOCK_TIME,
  publishedBy: "dispatcher-1",
  trips: [trip],
  deferrals: [],
  summary: { served: 1, deferred: 0, trips: 1 },
};
const allocationStats = {
  orders: 1,
  served: 1,
  deferred: 0,
  demandVolumeL: { FRESH: 40, STYLE_TECH: 0 },
  servedVolumeL: { FRESH: 40, STYLE_TECH: 0 },
  vehiclesAvailable: 1,
  vehiclesUsed: 1,
  tripSlotsAvailable: 2,
  tripsUsed: 1,
  reefers: { available: 1, used: 1 },
  vans: { available: 0, used: 0 },
  localSearchMoves: 0,
};

export const resourceFixtures = {
  window,
  contact,
  outlet,
  vehicle,
  product,
  calendarDay: {
    date: MOCK_DATE,
    dow: 5,
    isoYear: 2026,
    isoWeek: 40,
    isPayday: false,
    festival: null,
    festivalRamp: 0,
    isHoliday: false,
    monsoon: false,
    isOperating: true,
  },
  orderLine,
  order,
  orderDetail: { order, timeline: [] },
  stop,
  trip,
  rulesConfig: { ...DEFAULT_RULES_CONFIG, priorityOrder: [...DEFAULT_RULES_CONFIG.priorityOrder] },
  deferral,
  draftTrip,
  draftData,
  draft,
  planVersion,
  allocationStats,
} satisfies {
  [
    K in
      | "window"
      | "contact"
      | "outlet"
      | "vehicle"
      | "product"
      | "calendarDay"
      | "orderLine"
      | "order"
      | "orderDetail"
      | "stop"
      | "trip"
      | "rulesConfig"
      | "deferral"
      | "draftTrip"
      | "draftData"
      | "draft"
      | "planVersion"
      | "allocationStats"
  ]: ApiDtoInput<K>;
};
