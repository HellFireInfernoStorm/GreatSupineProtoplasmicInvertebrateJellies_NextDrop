import { afterEach, describe, expect, it, vi } from "vitest";
import { createFeedHub, type FeedHint } from "./hub";

afterEach(() => {
  vi.useRealTimers();
});

describe("feed hub", () => {
  it("polls only while subscribed and broadcasts only changed hints", async () => {
    vi.useFakeTimers();
    let hint: FeedHint = { head: "1", resetEpoch: 0 };
    const read = vi.fn(async () => hint);
    const hub = createFeedHub(read, 1000, () => {});
    await vi.advanceTimersByTimeAsync(5000);
    expect(read).not.toHaveBeenCalled();

    const seen: FeedHint[] = [];
    const unsubscribe = hub.subscribe((h) => seen.push(h));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([{ head: "1", resetEpoch: 0 }]);
    hint = { head: "3", resetEpoch: 0 };
    await vi.advanceTimersByTimeAsync(1000);
    hint = { head: "3", resetEpoch: 1 };
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen.slice(1)).toEqual([
      { head: "3", resetEpoch: 0 },
      { head: "3", resetEpoch: 1 },
    ]);

    unsubscribe();
    const calls = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(read.mock.calls.length).toBe(calls);
  });

  it("reports read errors and keeps polling", async () => {
    vi.useFakeTimers();
    const errors: unknown[] = [];
    let fail = true;
    const hub = createFeedHub(
      async () => {
        if (fail) throw new Error("db down");
        return { head: "2", resetEpoch: 0 };
      },
      1000,
      (error) => errors.push(error),
    );
    const seen: FeedHint[] = [];
    hub.subscribe((h) => seen.push(h));
    await vi.advanceTimersByTimeAsync(1000);
    fail = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(errors).toHaveLength(1);
    expect(seen).toEqual([{ head: "2", resetEpoch: 0 }]);
    hub.close();
  });
});
