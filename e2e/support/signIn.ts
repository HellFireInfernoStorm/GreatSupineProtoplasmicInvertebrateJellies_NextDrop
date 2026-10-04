import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { DEMO_PASSWORD, DEMO_PIN, DEPOTS, type Account } from "./accounts";
import { VIEWPORTS, type ViewportName } from "./viewports";

// Each role signs in through its own login screen by typing, as a judge without the quick-login chips would.
// Every role keeps its own browser context, so the four roles stay signed in side by side through the walkthrough.

export interface RoleWindow {
  context: BrowserContext;
  page: Page;
}

export interface SignInOptions {
  viewport: ViewportName;
  /** Dispatcher only: the depot chosen at sign-in. */
  depot?: string;
}

async function typePin(page: Page, idLabel: string, account: Account): Promise<void> {
  await page.getByLabel(idLabel).fill(account.login);
  for (const digit of DEMO_PIN) await page.getByRole("button", { name: digit, exact: true }).click();
}

/** Fill and submit the login screen for `account` on a page that is already open. */
export async function signInOn(page: Page, account: Account, depot: string = DEPOTS.peliyagoda): Promise<void> {
  await page.goto(account.loginPath);
  switch (account.role) {
    case "STORE":
      await page.getByLabel("Email or outlet ID").fill(account.login);
      await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD);
      break;
    case "DISPATCHER":
      await page.getByLabel("Work email").fill(account.login);
      await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD);
      // The option's value is the depot's name; its label adds "DC" or "hub".
      await page.getByLabel("Depot").selectOption(depot);
      break;
    case "LOADER":
      await typePin(page, "Loader ID", account);
      break;
    case "DRIVER":
      await typePin(page, "Driver ID", account);
      break;
  }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${account.home}(/|$)`));
}

/** Open a window of its own for `account` at the given width and sign in. */
export async function signIn(browser: Browser, account: Account, options: SignInOptions): Promise<RoleWindow> {
  const context = await browser.newContext({ viewport: VIEWPORTS[options.viewport] });
  const page = await context.newPage();
  await signInOn(page, account, options.depot);
  return { context, page };
}
