# e2e: Playwright walkthrough and offline tests

Read first: [seed-and-demo.md](../agent-docs/spec/data/seed-and-demo.md), [testing.md](../agent-docs/spec/platform/testing.md).

- The main test is the 14-step judge walkthrough. Keep it identical to the numbered steps in the root README, and update both together.
- Reset to a known preset through the demo endpoints before each scenario. Do not depend on state left by another test.
- Driver and Loader run at phone width. Offline cases use both browser offline mode and the in-app force-offline switch.
- Include an axe accessibility smoke check per role.
