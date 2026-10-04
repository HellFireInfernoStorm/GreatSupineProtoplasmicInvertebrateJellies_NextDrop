import { ACCOUNTS, type Account } from "../support/accounts";
import { expectNoSeriousA11yViolations } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { signIn } from "../support/signIn";
import { VIEWPORTS, type ViewportName } from "../support/viewports";

// The axe accessibility smoke check, one per role at the width the role is judged at (issue #62). Each role's
// login screen and first screen are checked. Add a role's later screens here as its app merges.

interface RoleCheck {
  name: string;
  account: Account;
  viewport: ViewportName;
  /**
   * A violation axe finds today, per screen. The test is then expected to fail, and fails the run once the screen
   * is fixed, so the entry cannot outlive the problem. Listed in the plan comment of #62; never add one to hide a
   * new failure.
   */
  known?: { login?: string; home?: string };
}

const ROLES: RoleCheck[] = [
  {
    name: "Store manager at phone width",
    account: ACCOUNTS.store,
    viewport: "phone",
    known: { home: "Tab bar: the inactive tabs are #9aa3b0 on white, 2.54:1 at 12 px (needs 4.5:1)" },
  },
  { name: "Store manager at desktop width", account: ACCOUNTS.store, viewport: "desktop" },
  {
    name: "Dispatcher at desktop width",
    account: ACCOUNTS.dispatcher,
    viewport: "desktop",
    known: {
      login: "Link colour #2778f8 on white is 4.09:1 at 14 px (needs 4.5:1)",
      home: "Dashboard: muted text #6b7585 on #f6f9fa is 4.4:1, the info banner's #1f6bd6 on #e5f0ff is 4.41:1",
    },
  },
  { name: "Loader at phone width", account: ACCOUNTS.loader, viewport: "phone" },
  { name: "Loader at tablet width", account: ACCOUNTS.loader, viewport: "tablet" },
  { name: "Driver at phone width", account: ACCOUNTS.driver, viewport: "phone" },
];

test.beforeAll(async ({ demo }) => {
  await demo.reset("before-cutoff");
});

for (const { name, account, viewport, known } of ROLES) {
  test.describe(name, () => {
    test("the login screen passes the axe smoke check", async ({ browser }) => {
      test.fail(!!known?.login, known?.login);
      const context = await browser.newContext({ viewport: VIEWPORTS[viewport] });
      const page = await context.newPage();
      await page.goto(account.loginPath);
      await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      await context.close();
    });

    test("the first screen after sign-in passes the axe smoke check", async ({ browser }) => {
      test.fail(!!known?.home, known?.home);
      const { context, page } = await signIn(browser, account, { viewport });
      await page.waitForLoadState("networkidle");
      await expectNoSeriousA11yViolations(page);
      await context.close();
    });
  });
}
