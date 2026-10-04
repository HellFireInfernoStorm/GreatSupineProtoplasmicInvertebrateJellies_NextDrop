import { ACCOUNTS } from "../support/accounts";
import { expect, test } from "../support/fixtures";
import { signIn } from "../support/signIn";

// #147: the Driver's "Simulate offline" switch turns off after a reload, and the phone reconnects at once.
// Settings used to show the switch unchecked until the saved value loaded, so a check read too early saw "off".
test("the Simulate offline switch shows its saved state and turns off straight away", async ({ browser, demo }) => {
  await demo.reset("mid-run");
  const driver = await signIn(browser, ACCOUNTS.driver, { viewport: "phone" });
  try {
    const { page } = driver;
    await page.goto("/driver/settings");
    const simulate = page.getByRole("checkbox", { name: "Simulate offline" });
    const signOut = page.getByRole("button", { name: "Sign out" });
    await simulate.click();
    await expect(simulate).toBeChecked();
    await expect(signOut).toBeDisabled();

    await page.reload();
    // The first read already reflects the saved switch.
    expect(await simulate.isChecked()).toBe(true);
    await simulate.click();
    await expect(simulate).not.toBeChecked();
    await expect(signOut).toBeEnabled({ timeout: 2000 });
  } finally {
    await driver.context.close();
  }
});
