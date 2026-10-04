import { colomboInstant } from "@nextdrop/rules";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTransport } from "../../../lib/api";
import { MOCK_PRODUCTS, mockStoreRespond } from "../../../lib/api/mockStore";
import type { TransportRequest } from "../../../lib/api/types";
import { timeLeft } from "../dates";
import { draft, draftLines, keyFor, orderSignature, quantitiesOf, totalUnits, useDraft, type Product } from "./draft";
import { dateOptions, orderDate } from "./useOrderModel";
import { placeOrders } from "./useSubmitOrders";

const products = MOCK_PRODUCTS as readonly Product[];
const rice = products.find((p) => p.sku === "FD-101")!;
const pasta = products.find((p) => p.sku === "FD-114")!;
const milk = products.find((p) => p.sku === "FC-201")!;
const calendar = new Map<string, never>();
/** Sat 3 Oct 2026 at the given Colombo time (minutes since midnight). Sunday 4 Oct has no deliveries. */
const saturdayAt = (minute: number) => colomboInstant("2026-10-03", minute);

beforeEach(() => useDraft.setState({ date: null, qty: {}, keys: {}, placed: null }));
afterEach(() => setTransport(null));

describe("the draft", () => {
  it("splits into one order per temperature, in catalogue order, without empty lines", () => {
    const qty = { [milk.id]: 24, [pasta.id]: 20, [rice.id]: 10, "gone-from-catalogue": 3 };
    expect(draftLines(products, qty, "ambient").map((l) => [l.product.sku, l.qty])).toEqual([
      ["FD-101", 10],
      ["FD-114", 20],
    ]);
    expect(draftLines(products, { ...qty, [rice.id]: 0 }, "ambient").map((l) => l.product.sku)).toEqual(["FD-114"]);
    expect(totalUnits(draftLines(products, qty, "chilled"))).toBe(24);
  });

  it("reads last week's quantities from earlier orders", () => {
    const answer = mockStoreRespond(
      { name: "storeOrders", url: "/api/store/orders?date=2026-09-28", body: undefined, headers: {} },
      saturdayAt(600),
    );
    const orders = (answer!.body as { items: Parameters<typeof quantitiesOf>[0] }).items;
    expect(quantitiesOf(orders)[rice.id]).toBe(10);
    expect(quantitiesOf(orders)[milk.id]).toBe(24);
  });

  it("repeating last week keeps only products the catalogue still has", () => {
    draft.fill({ [rice.id]: 10, "discontinued-product": 4 }, products);
    expect(useDraft.getState().qty).toEqual({ [rice.id]: 10 });
  });
});

describe("the idempotency key", () => {
  const lines = draftLines(products, { [rice.id]: 10 }, "ambient");

  it("is reused for the same order and replaced when the order changes", () => {
    let n = 0;
    const mint = () => `key-${++n}`;
    const first = keyFor(undefined, orderSignature("2026-10-05", lines), mint);
    expect(keyFor(first, orderSignature("2026-10-05", lines), mint)).toBe(first);
    const more = draftLines(products, { [rice.id]: 11 }, "ambient");
    expect(keyFor(first, orderSignature("2026-10-05", more), mint).key).toBe("key-2");
    expect(keyFor(first, orderSignature("2026-10-06", lines), mint).key).toBe("key-3");
  });

  it("does not depend on the order the lines are listed in", () => {
    const both = draftLines(products, { [rice.id]: 10, [pasta.id]: 20 }, "ambient");
    expect(orderSignature("2026-10-05", both)).toBe(orderSignature("2026-10-05", [...both].reverse()));
  });
});

describe("placing the orders", () => {
  const orders = [
    { temp: "ambient" as const, lines: draftLines(products, { [rice.id]: 10 }, "ambient") },
    { temp: "chilled" as const, lines: draftLines(products, { [milk.id]: 24 }, "chilled") },
  ];
  const sent: TransportRequest[] = [];
  /** A server that takes the dry order, then loses the connection once, then works. */
  function flakyServer() {
    sent.length = 0;
    let failNext = true;
    setTransport(async (request) => {
      sent.push(request);
      if (request.body && JSON.stringify(request.body).includes(milk.id) && failNext) {
        failNext = false;
        throw new TypeError("Failed to fetch");
      }
      return mockStoreRespond(request, saturdayAt(600))!;
    });
  }

  it("sends one order per temperature and shows both confirmations", async () => {
    setTransport(async (request) => mockStoreRespond(request, saturdayAt(600))!);
    useDraft.setState({ qty: { [rice.id]: 10, [milk.id]: 24 } });
    expect(await placeOrders("2026-10-05", orders)).toBeNull();
    const placed = useDraft.getState().placed!;
    expect(placed.map((o) => o.tempRequirement)).toEqual(["ambient", "chilled"]);
    expect(new Set(placed.map((o) => o.displayId)).size).toBe(2);
    // A fresh draft follows.
    expect(useDraft.getState().qty).toEqual({});
  });

  it("retries with the same keys, so the dry order that got through is not placed twice", async () => {
    flakyServer();
    expect(await placeOrders("2026-10-05", orders)).toEqual({ kind: "network", placedBefore: 1 });
    expect(useDraft.getState().placed).toBeNull();
    const firstKeys = sent.map((r) => r.headers["idempotency-key"]);

    expect(await placeOrders("2026-10-05", orders)).toBeNull();
    const retryKeys = sent.slice(2).map((r) => r.headers["idempotency-key"]);
    expect(retryKeys).toEqual(firstKeys);
    // The server returned the dry order it already held: the same ID both times.
    const dryIds = useDraft.getState().placed!.filter((o) => o.tempRequirement === "ambient");
    expect(dryIds).toHaveLength(1);
  });

  it("reports an order the server refuses, and places nothing more", async () => {
    setTransport(async () => ({
      status: 422,
      body: { code: "VALIDATION_FAILED", message_key: "errors.validation_failed", params: {}, requestId: "r" },
    }));
    expect(await placeOrders("2026-10-05", orders)).toEqual({ kind: "rejected", placedBefore: 0 });
    expect(useDraft.getState().placed).toBeNull();
  });
});

describe("the delivery date", () => {
  it("offers the next days, with Sunday unavailable", () => {
    const options = dateOptions("2026-10-03", saturdayAt(600), calendar);
    expect(options.map((o) => o.date)).toEqual(["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);
    expect(options[0]).toMatchObject({ operating: false });
    expect(options[1]).toMatchObject({ operating: true, closed: false });
  });

  it("defaults to the first date still open", () => {
    // Saturday morning: Sunday has no deliveries, so Monday.
    expect(orderDate(null, "2026-10-03", saturdayAt(600), calendar)).toBe("2026-10-05");
  });

  it("rolls forward once the cutoff passes, even for a date the manager picked", () => {
    const monday = "2026-10-05";
    const sundayAt = (minute: number) => colomboInstant("2026-10-04", minute);
    // Sunday 15:59: Monday is still open.
    expect(orderDate(monday, "2026-10-04", sundayAt(959), calendar)).toBe(monday);
    // Sunday 16:00: Monday has closed, so the order goes to Tuesday.
    expect(orderDate(monday, "2026-10-04", sundayAt(960), calendar)).toBe("2026-10-06");
    expect(dateOptions("2026-10-04", sundayAt(960), calendar)[0]).toMatchObject({ date: monday, closed: true });
  });

  it("keeps a later date the manager picked", () => {
    expect(orderDate("2026-10-07", "2026-10-03", saturdayAt(600), calendar)).toBe("2026-10-07");
  });
});

describe("the countdown", () => {
  it("counts whole hours and minutes, and never goes below zero", () => {
    expect(timeLeft(10_080_000 + 30_000, 0)).toEqual({ hours: 2, minutes: 48 });
    expect(timeLeft(0, 5_000)).toEqual({ hours: 0, minutes: 0 });
  });
});
