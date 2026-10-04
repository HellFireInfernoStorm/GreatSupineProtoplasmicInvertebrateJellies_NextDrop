// Story fixtures layered over the bulk peak day (seed-and-demo.md §15.1 item 5, §15.5, ADR 0008): the Kandy orders the
// walkthrough's field steps run on. IDs, outlets and the trip come from story-fixtures.ts.
//
// Seeded state is the start of the story: orders placed, ORD10412 carried over from yesterday. The loader shortfall,
// the offline deliveries, the clash and the dispute are reached through the demo presets, not seeded.
import type { Calendar } from "@nextdrop/rules";
import { colomboIso, deferral, type OrderSpec } from "./orders";
import { HILL_STORE_OUTLET_ID, STORY_DATE, WALKTHROUGH_TRIP } from "./story-fixtures";

/** The design's named orders, now at the hill store (ADR 0008, design/mock-story.md). */
export const STORY_CHILLED_ORDER_ID = "ORD10412";
export const STORY_DRY_ORDER_ID = "ORD10468";

/**
 * The other Kandy reefer trucks, in the workshop on the story date so that proposing the Kandy plan puts the hill trip
 * on the walkthrough vehicle (ADR 0048, issue #133). The allocator takes the first reefer truck that fits, so all four
 * are out; the reefer vans stay available, and Kandy still serves every story order.
 */
export const HILL_RUN_WORKSHOP: readonly {
  readonly vehicleId: string;
  readonly reason: "SERVICE" | "BREAKDOWN";
}[] = [
  { vehicleId: "VEH040", reason: "SERVICE" },
  { vehicleId: "VEH041", reason: "SERVICE" },
  { vehicleId: "VEH042", reason: "SERVICE" },
  { vehicleId: "VEH043", reason: "SERVICE" },
];

/** Every order ID the story uses; the bulk generator skips them. */
export function storyOrderIds(calendar: Calendar): ReadonlySet<string> {
  return new Set(storyOrders(calendar).map((o) => o.displayId));
}

export function storyOrders(calendar: Calendar): OrderSpec[] {
  const [first, store, third, fourth] = WALKTHROUGH_TRIP.stopOutletIds;
  if (store !== HILL_STORE_OUTLET_ID || !first || !third || !fourth) {
    throw new Error("story-fixtures.ts: the hill store must be stop 2 of a 4-stop trip");
  }
  const chilled = (displayId: string, outletId: string, lines: OrderSpec["lines"], placedAt: string): OrderSpec => ({
    displayId,
    outletId,
    brand: "Fresh",
    temp: "chilled",
    lines,
    requestedDate: STORY_DATE,
    deliveryDate: STORY_DATE,
    placedAt,
    deferrals: [],
  });

  return [
    // The hill trip: a chilled order at every stop, and the store's dry order.
    chilled(
      "ORD10490",
      first,
      [
        { sku: "FR-MILK-CRATE", qty: 10 },
        { sku: "FR-YOGHURT-CRATE", qty: 6 },
      ],
      colomboIso("2026-09-28", "09:40"),
    ),
    {
      // 12 milk + 8 eggs = 20 crates. Ordered Sun 27 Sep 14:05 for Mon 28, deferred that night (reefer capacity full).
      displayId: STORY_CHILLED_ORDER_ID,
      outletId: store,
      brand: "Fresh",
      temp: "chilled",
      lines: [
        { sku: "FR-EGGS-CRATE", qty: 8 },
        { sku: "FR-MILK-CRATE", qty: 12 },
      ],
      requestedDate: "2026-09-28",
      deliveryDate: STORY_DATE,
      placedAt: colomboIso("2026-09-27", "14:05"),
      deferrals: [deferral("2026-09-28", "2026-09-28", STORY_DATE, "21:40", "REEFER_SHORTAGE", 1, calendar)],
    },
    {
      // 18 cases of dry goods for the same delivery.
      displayId: STORY_DRY_ORDER_ID,
      outletId: store,
      brand: "Fresh",
      temp: "ambient",
      lines: [
        { sku: "FR-BISCUIT-CASE", qty: 6 },
        { sku: "FR-TEA-CASE", qty: 6 },
        { sku: "FR-WATER-CASE", qty: 6 },
      ],
      requestedDate: STORY_DATE,
      deliveryDate: STORY_DATE,
      placedAt: colomboIso("2026-09-28", "11:20"),
      deferrals: [],
    },
    chilled(
      "ORD10491",
      third,
      [
        { sku: "FR-CHICKEN-CRATE", qty: 6 },
        { sku: "FR-MILK-CRATE", qty: 8 },
      ],
      colomboIso("2026-09-28", "10:15"),
    ),
    chilled(
      "ORD10492",
      fourth,
      [
        { sku: "FR-MILK-CRATE", qty: 6 },
        { sku: "FR-VEG-CRATE", qty: 4 },
      ],
      colomboIso("2026-09-28", "13:30"),
    ),
    // A handful of other Kandy orders, so the Kandy plan is more than the hill trip.
    {
      displayId: "ORD10493",
      outletId: "OUT084",
      brand: "Fresh",
      temp: "ambient",
      lines: [
        { sku: "FR-FLOUR-BAG", qty: 12 },
        { sku: "FR-RICE-BAG", qty: 10 },
        { sku: "FR-SUGAR-BAG", qty: 10 },
      ],
      requestedDate: STORY_DATE,
      deliveryDate: STORY_DATE,
      placedAt: colomboIso("2026-09-28", "08:50"),
      deferrals: [],
    },
    {
      displayId: "ORD10494",
      outletId: "OUT091",
      brand: "Style",
      temp: "ambient",
      lines: [
        { sku: "ST-APPAREL-CARTON", qty: 18 },
        { sku: "ST-SAREE-CARTON", qty: 10 },
      ],
      requestedDate: STORY_DATE,
      deliveryDate: STORY_DATE,
      placedAt: colomboIso("2026-09-28", "12:05"),
      deferrals: [],
    },
    {
      displayId: "ORD10495",
      outletId: "OUT095",
      brand: "Tech",
      temp: "ambient",
      lines: [{ sku: "TC-FRIDGE", qty: 4 }],
      requestedDate: STORY_DATE,
      deliveryDate: STORY_DATE,
      placedAt: colomboIso("2026-09-28", "15:10"),
      deferrals: [],
    },
  ];
}
