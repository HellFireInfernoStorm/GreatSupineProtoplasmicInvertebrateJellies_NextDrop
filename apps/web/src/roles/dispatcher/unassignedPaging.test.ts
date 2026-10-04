import { describe, expect, it } from "vitest";
import { pageUnassigned, UNASSIGNED_PAGE_SIZE } from "./unassignedPaging";

const orders = (count: number) => Array.from({ length: count }, (_, index) => `order-${index + 1}`);
const scope = "Peliyagoda|2026-10-04|draft-1";
const at = (index: number) => ({ scope, index });

describe("Unassigned paging", () => {
  it("shows zero range and no pages for no orders", () => {
    expect(pageUnassigned([], scope, at(7))).toEqual({
      state: at(0),
      items: [],
      total: 0,
      pageCount: 0,
      from: 0,
      to: 0,
    });
  });

  it.each([1, 3, UNASSIGNED_PAGE_SIZE])("keeps %i orders on one page with both boundaries reached", (count) => {
    const list = orders(count);
    const page = pageUnassigned(list, scope);
    expect(page).toMatchObject({ state: at(0), total: count, pageCount: 1, from: 1, to: count });
    expect(page.items).toEqual(list);
    expect(pageUnassigned(list, scope, at(99)).state.index).toBe(0);
  });

  it("shows a partial last page and exact visible range", () => {
    expect(pageUnassigned(orders(37), scope, at(9))).toMatchObject({
      state: at(9),
      items: ["order-37"],
      total: 37,
      pageCount: 10,
      from: 37,
      to: 37,
    });
    expect(pageUnassigned(orders(7), scope, at(1)).items).toEqual(["order-5", "order-6", "order-7"]);
  });

  it("keeps every order in deterministic input order across a large list without duplicates or mutation", () => {
    const list = Object.freeze(orders(10001));
    const seen: string[] = [];
    const { pageCount } = pageUnassigned(list, scope);
    for (let index = 0; index < pageCount; index++) {
      const page = pageUnassigned(list, scope, at(index));
      expect(page.items.length).toBeLessThanOrEqual(UNASSIGNED_PAGE_SIZE);
      seen.push(...page.items);
    }
    expect(seen).toEqual(list);
    expect(new Set(seen).size).toBe(list.length);
    expect(pageUnassigned(list, scope, at(pageCount - 1))).toMatchObject({ from: 10001, to: 10001 });
  });

  it("clamps after moving the only order off the last page", () => {
    const list = orders(9);
    const last = pageUnassigned(list, scope, at(2));
    const next = pageUnassigned(list.slice(0, -1), scope, last.state);
    expect(next).toMatchObject({ state: at(1), from: 5, to: 8, total: 8 });
    expect(next.items).toEqual(["order-5", "order-6", "order-7", "order-8"]);
  });

  it("clamps after a refresh shrinks the list, preserves a valid page, and handles deletion to empty", () => {
    const last = pageUnassigned(orders(37), scope, at(9));
    expect(pageUnassigned(orders(6), scope, last.state)).toMatchObject({ state: at(1), from: 5, to: 6 });
    expect(pageUnassigned(orders(12), scope, at(1)).state).toEqual(at(1));
    expect(pageUnassigned([], scope, last.state)).toMatchObject({ state: at(0), items: [], from: 0, to: 0 });
  });

  it.each(["Kandy|2026-10-04|draft-1", "Peliyagoda|2026-10-05|draft-1", "Peliyagoda|2026-10-04|draft-2"])(
    "resets on depot/day/draft scope change to %s",
    (nextScope) => {
      const previous = at(5);
      expect(pageUnassigned(orders(37), nextScope, previous)).toMatchObject({
        state: { scope: nextScope, index: 0 },
        from: 1,
        to: 4,
      });
      expect(previous).toEqual(at(5));
    },
  );

  it.each([-9, Number.NaN, Number.POSITIVE_INFINITY])("normalizes invalid index %s", (index) => {
    expect(pageUnassigned(orders(7), scope, at(index)).state.index).toBe(0);
  });
});
