import type { RoleWindow } from "./signIn";

/**
 * How a field device loses its connection. The walkthrough runs once with each (issue #62):
 * - `switch`: the in-app "Force offline" switch of the Loader and Driver sync bar (§15.2), what step 9 names;
 * - `browser`: the browser's own offline mode, as when the phone really has no signal.
 */
export type OfflineMode = "switch" | "browser";

const FORCE_OFFLINE = "Force offline";

export async function goOffline(device: RoleWindow, mode: OfflineMode): Promise<void> {
  if (mode === "browser") await device.context.setOffline(true);
  else await device.page.getByLabel(FORCE_OFFLINE).check();
}

export async function goOnline(device: RoleWindow, mode: OfflineMode): Promise<void> {
  if (mode === "browser") await device.context.setOffline(false);
  else await device.page.getByLabel(FORCE_OFFLINE).uncheck();
}
