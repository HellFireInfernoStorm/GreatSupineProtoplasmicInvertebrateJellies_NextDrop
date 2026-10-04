import { expect } from "@playwright/test";
import type { RoleWindow } from "./signIn";

/**
 * How the Driver's phone loses its connection. The walkthrough runs once with each (issue #62):
 * - `switch`: the in-app "Simulate offline" switch on the Driver's Settings screen (§15.2), what step 9 names;
 * - `browser`: the browser's own offline mode, as when the phone really has no signal.
 */
export type OfflineMode = "switch" | "browser";

/** Open the Driver's Settings, set the switch, and come back to the run. */
async function setSwitch(device: RoleWindow, offline: boolean): Promise<void> {
  const { page } = device;
  await page.getByRole("link", { name: "Settings" }).click();
  const simulate = page.getByRole("checkbox", { name: "Simulate offline" });
  // The switch is saved on the phone before it shows, so click it and wait rather than expect an instant change.
  if ((await simulate.isChecked()) !== offline) await simulate.click();
  await expect(simulate).toBeChecked({ checked: offline });
  await page.getByRole("link", { name: "Back to run" }).click();
}

export async function goOffline(device: RoleWindow, mode: OfflineMode): Promise<void> {
  if (mode === "browser") await device.context.setOffline(true);
  else await setSwitch(device, true);
}

export async function goOnline(device: RoleWindow, mode: OfflineMode): Promise<void> {
  if (mode === "browser") await device.context.setOffline(false);
  else await setSwitch(device, false);
}
