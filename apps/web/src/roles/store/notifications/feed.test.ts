import { describe, expect, it } from "vitest";
import { advance } from "./feed";

const row = (seq: string) => ({
  seq,
  kind: "order_changed" as const,
  entity: { type: "order", id: "o" },
  at: "2026-10-03T00:00:00.000Z",
});

describe("the Store's place in the change feed", () => {
  it("starts at the head without refreshing: the screen has just loaded", () => {
    expect(advance(null, { items: [row("7"), row("9")], head: "9" })).toEqual({ cursor: "9", changed: false });
  });
  it("stays put when nothing is new", () => {
    expect(advance("9", { items: [], head: "9" })).toEqual({ cursor: "9", changed: false });
  });
  it("refreshes on a new row and moves to the head", () => {
    expect(advance("9", { items: [row("12")], head: "14" })).toEqual({ cursor: "14", changed: true });
  });
  it("carries on from the last row when a page is full", () => {
    expect(advance("9", { items: [row("10"), row("11")], head: "30" }, 2)).toEqual({ cursor: "11", changed: true });
  });
  it("does not refresh for an answer that repeats where it already is", () => {
    expect(advance("9", { items: [row("9")], head: "9" })).toEqual({ cursor: "9", changed: false });
  });
});
