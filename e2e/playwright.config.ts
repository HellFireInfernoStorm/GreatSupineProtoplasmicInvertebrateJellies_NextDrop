import { defineConfig } from "@playwright/test";
import type { WalkthroughOptions } from "./support/fixtures";

// Where the stack runs. Default: `docker compose up` on this machine. Point it at the public deployment with
// E2E_BASE_URL=https://… (issue #62, #33).
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:8080";

export default defineConfig<object, WalkthroughOptions>({
  testDir: "./tests",
  // One database and one demo clock behind every test, and each scenario resets them: nothing runs in parallel.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    locale: "en-GB",
    timezoneId: "Asia/Colombo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // E2E_BROWSER_CHANNEL=chrome uses the installed Chrome instead of Playwright's downloaded Chromium.
    channel: process.env.E2E_BROWSER_CHANNEL || undefined,
  },
  // The walkthrough runs twice, so that between the two runs the Loader is seen at phone and at tablet width and
  // the offline steps use both the in-app force-offline switch and the browser's offline mode.
  projects: [
    {
      name: "walkthrough-phone-force-offline",
      testMatch: "walkthrough.spec.ts",
      use: { loaderViewport: "phone", offlineMode: "switch" },
    },
    {
      name: "walkthrough-tablet-browser-offline",
      testMatch: "walkthrough.spec.ts",
      use: { loaderViewport: "tablet", offlineMode: "browser" },
    },
    { name: "accessibility", testMatch: "accessibility.spec.ts" },
  ],
});
