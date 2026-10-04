import type { ViewportSize } from "@playwright/test";

// The widths the walkthrough is judged at. Below 1024 px the app uses a role's phone design (apps/web lib/layout).

export const VIEWPORTS = {
  /** Driver and Loader, and the Store manager in step 1: the Driver app is designed at 360×800. */
  phone: { width: 360, height: 800 },
  /** The Loader's dock tablet, held sideways. */
  tablet: { width: 1280, height: 800 },
  /** The Dispatcher's desk, and the Store's desktop design. */
  desktop: { width: 1440, height: 900 },
} as const satisfies Record<string, ViewportSize>;

export type ViewportName = keyof typeof VIEWPORTS;
