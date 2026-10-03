import type { HumanRole } from "@nextdrop/contracts";
import { create } from "zustand";

/** True when the build runs against a DEMO_MODE deployment. It turns on the quick-login chips. */
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";

/** The last demo reset, as carried by the demo state, the change feed and the field snapshot (ADR 0007). */
export interface DemoNotice {
  resetEpoch: number;
  lastResetBy: HumanRole | null;
  lastResetAt: string | null;
}

interface DemoNoticeState {
  notice: DemoNotice | null;
}

const useDemoNoticeStore = create<DemoNoticeState>(() => ({ notice: null }));

/** The notice the reset banner shows in every shell, or null. */
export function useDemoNotice(): DemoNotice | null {
  return useDemoNoticeStore((s) => s.notice);
}

/** The demo module and the sync controller call this when they see a reset. */
export function setDemoNotice(notice: DemoNotice | null): void {
  useDemoNoticeStore.setState({ notice });
}
