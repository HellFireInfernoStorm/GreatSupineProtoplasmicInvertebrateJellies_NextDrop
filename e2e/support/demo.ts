import { ApiSession } from "./api";

// The demo tooling of spec/data/seed-and-demo.md §15.2, driven as the dispatcher.

export type DemoPreset = "before-cutoff" | "orders-closed" | "plan-published" | "loading" | "mid-run" | "clash-ready";

export interface DemoState {
  serverTime: string;
  preset: DemoPreset;
  resetEpoch: number;
}

/** The story: `before-cutoff` puts the clock at Mon 28 Sep 2026 14:00 and opens the day for Tue 29 Sep (ADR 0033). */
export const STORY = {
  orderDay: "2026-09-28",
  deliveryDay: "2026-09-29",
  /** The daily cutoff, in Asia/Colombo. */
  cutoff: "16:00",
} as const;

/** An instant given as a date and a wall-clock time in Asia/Colombo (UTC+05:30, no daylight saving). */
export function colombo(date: string, time: string): string {
  return new Date(`${date}T${time}:00+05:30`).toISOString();
}

export class Demo {
  private constructor(private readonly api: ApiSession) {}

  static async open(baseURL: string): Promise<Demo> {
    return new Demo(await ApiSession.dispatcher(baseURL));
  }

  state(): Promise<DemoState> {
    return this.api.get<DemoState>("/api/demo/state");
  }

  /** Restore the operational tables to a checkpoint. Every scenario starts with this. */
  reset(preset: DemoPreset = "before-cutoff"): Promise<DemoState> {
    return this.api.post<DemoState>("/api/demo/reset", { preset });
  }

  /**
   * Move the demo clock, then run the tick so the time-driven transitions (orders close at the cutoff) apply now
   * instead of on the next minute's job.
   */
  async setClock(date: string, time: string): Promise<DemoState> {
    const state = await this.api.post<DemoState>("/api/demo/clock", { serverTime: colombo(date, time) });
    await this.api.post("/api/demo/tick");
    return state;
  }

  /** The planning day's state as the dispatcher's API reports it: `OPEN` until the cutoff, then `CLOSED`. */
  async dayState(date: string, depot: string): Promise<string> {
    const day = await this.api.get<{ state: string }>(`/api/dispatch/days/${date}?depot=${depot}`);
    return day.state;
  }

  async close(): Promise<void> {
    await this.api.dispose();
  }
}
