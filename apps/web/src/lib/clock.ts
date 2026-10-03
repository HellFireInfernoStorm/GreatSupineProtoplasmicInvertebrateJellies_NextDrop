import { useEffect, useState } from "react";
import { create } from "zustand";

// The server owns time (spec/overview.md, principle 7). The client learns the offset from the serverTime that API
// responses carry and uses it for display only, never to order or decide anything (spec/sync/versioning-and-clocks.md).

import { offlineDb } from "../sync/database";

interface ClockState {
  /** Server minus device, in milliseconds. Zero until a response has been observed. */
  offsetMs: number;
}

const useClockStore = create<ClockState>(() => ({ offsetMs: 0 }));

/** Server minus device for one observation. */
export function offsetFrom(serverTimeIso: string, deviceNowMs: number): number | null {
  const serverMs = Date.parse(serverTimeIso);
  return Number.isNaN(serverMs) ? null : serverMs - deviceNowMs;
}

/** Record the serverTime of an API response. Called by the API client for every response that carries one. */
export function observeServerTime(serverTimeIso: string, deviceNowMs: number = Date.now()): void {
  const offsetMs = offsetFrom(serverTimeIso, deviceNowMs);
  if (offsetMs !== null) {
    useClockStore.setState({ offsetMs });
    if (typeof indexedDB !== "undefined") void offlineDb.set("serverOffset", offsetMs).catch(() => undefined);
  }
}

/** Server minus device as last known. Field events record it as clockOffsetMs (spec/events/envelope.md). */
export function clockOffsetMs(): number {
  return useClockStore.getState().offsetMs;
}

/** The current server time as epoch milliseconds. */
export function serverNowMs(deviceNowMs: number = Date.now()): number {
  return deviceNowMs + clockOffsetMs();
}

/** The current server time, re-rendering every tickMs. Use it for every countdown, ETA and displayed "now". */
export function useServerNow(tickMs: number = 1000): Date {
  const offsetMs = useClockStore((s) => s.offsetMs);
  const [deviceNowMs, setDeviceNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setDeviceNowMs(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  return new Date(deviceNowMs + offsetMs);
}

export function restoreClockOffset(offsetMs: number): void {
  useClockStore.setState({ offsetMs });
}
