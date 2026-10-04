import { test as base } from "@playwright/test";
import { Demo } from "./demo";
import type { OfflineMode } from "./offline";
import type { ViewportName } from "./viewports";

/** What differs between the two walkthrough runs (playwright.config.ts). */
export interface WalkthroughOptions {
  /** The Loader's width in step 7. The Driver is always at phone width. */
  loaderViewport: Extract<ViewportName, "phone" | "tablet">;
  /** How the Driver goes offline in step 9. */
  offlineMode: OfflineMode;
}

interface WorkerFixtures extends WalkthroughOptions {
  /** The demo tooling, signed in as the dispatcher for the whole file. */
  demo: Demo;
}

export const test = base.extend<object, WorkerFixtures>({
  loaderViewport: ["phone", { option: true, scope: "worker" }],
  offlineMode: ["switch", { option: true, scope: "worker" }],
  demo: [
    async ({ playwright: _playwright }, use, workerInfo) => {
      const baseURL = workerInfo.project.use.baseURL;
      if (!baseURL) throw new Error("No baseURL: set E2E_BASE_URL or use the default in playwright.config.ts");
      const demo = await Demo.open(baseURL);
      await use(demo);
      await demo.close();
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";
