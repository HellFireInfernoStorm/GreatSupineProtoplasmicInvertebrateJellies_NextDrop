import { ACCOUNTS, DEPOTS } from "../support/accounts";
import { STORY } from "../support/demo";
import { expect, test } from "../support/fixtures";
import { signIn, type RoleWindow } from "../support/signIn";
import { publishPlanDeferring } from "../support/standIns";

// The reference judge walkthrough of agent-docs/spec/data/seed-and-demo.md §15.4: fourteen steps, in order, across
// the four roles. Each test is one step and is titled with the step's wording. The README's numbered walkthrough
// repeats the same steps: change both together (e2e/AGENTS.md).
//
// A step whose screens are not merged yet is `test.fixme` and names the issue it waits on. It becomes a real step
// in the PR that follows that feature (issue #62). Do not weaken a step to make it pass.

test.describe.configure({ mode: "serial" });

/** The order's display ID out of a line such as "Dry · ORD10496". */
function orderId(text: string | null): string {
  const id = /ORD\d+/.exec(text ?? "")?.[0];
  if (!id) throw new Error(`No order ID in "${text}"`);
  return id;
}

test.describe("Judge walkthrough (§15.4)", () => {
  let store: RoleWindow;
  /** The confirmation IDs from step 1. */
  const placed = { dry: "", chilled: "" };

  test.afterAll(async () => {
    await store?.context.close();
  });

  test("1. Reset to before-cutoff. Store: sign in on a phone-width window, see the cutoff countdown (server time), place a dry and a chilled order for tomorrow; receive confirmation.", async ({
    browser,
    demo,
  }) => {
    await demo.reset("before-cutoff");

    store = await signIn(browser, ACCOUNTS.store, { viewport: "phone" });
    const { page } = store;

    // The reset puts the server clock at Mon 28 Sep 14:00, so the countdown reads just under two hours whatever
    // this machine's clock says.
    await expect(page.getByText("Tue 29 Sep order")).toBeVisible();
    await expect(page.getByText(/^closes in 1 h 5\d min$/)).toBeVisible();
    await page.getByRole("link", { name: "Place order" }).click();
    await expect(page.getByText("Tue 29 Sep closes 16:00")).toBeVisible();
    await expect(page.getByText(/^1 h 5\d min left$/)).toBeVisible();
    await expect(page.getByRole("radio", { name: "Tue 29 Sep" })).toBeChecked();

    // The dry order.
    await page.getByRole("link", { name: "Add items from the catalogue" }).click();
    await page.getByRole("spinbutton", { name: /Rice, 25 kg bag/ }).fill("4");
    await page.getByRole("button", { name: "Done · 1 item in dry order" }).click();

    // The chilled order: its own order for the same date.
    await page.getByRole("tab", { name: /^Chilled/ }).click();
    await page.getByRole("link", { name: "Add items from the catalogue" }).click();
    await page.getByRole("spinbutton", { name: /Fresh milk/ }).fill("2");
    await page.getByRole("button", { name: "Done · 1 item in chilled order" }).click();

    await page.getByRole("button", { name: "Review 2 orders · 6 units" }).click();
    await page.getByRole("button", { name: "Submit 2 orders" }).click();

    // The confirmation: one ID per order, for tomorrow.
    await expect(page.getByRole("heading", { name: "2 orders placed" })).toBeVisible();
    await expect(page.getByText("Delivery Tue 29 Sep")).toBeVisible();
    const dry = page.getByRole("heading", { name: /^Dry · ORD\d+$/ });
    const chilled = page.getByRole("heading", { name: /^Chilled · ORD\d+$/ });
    await expect(dry).toBeVisible();
    await expect(chilled).toBeVisible();
    placed.dry = orderId(await dry.textContent());
    placed.chilled = orderId(await chilled.textContent());
    expect(placed.dry).not.toBe(placed.chilled);
  });

  test("2. Advance the demo clock past 16:00. Orders close.", async ({ demo }) => {
    await demo.setClock(STORY.orderDay, "16:05");
    expect(await demo.dayState(STORY.deliveryDay, DEPOTS.peliyagoda)).toBe("CLOSED");

    // The store sees it too: tomorrow can no longer be picked, and the countdown now runs to the next day's cutoff.
    const { page } = store;
    await page.goto("/store/order");
    await expect(page.getByRole("radio", { name: "Tue Closed" })).toBeDisabled();
    await expect(page.getByRole("radio", { name: "Wed 30 Sep" })).toBeChecked();
    await expect(page.getByText("Wed 30 Sep closes 16:00")).toBeVisible();
  });

  // Waits on #46 (dispatcher D0-D2).
  test.fixme("3. Dispatcher: open the queue; see demand exceed capacity; Propose plan; inspect trips and capacity bars.", async () => {});

  // Waits on #46 (dispatcher D0-D2).
  test.fixme("4. Attempt a rule-breaking move (e.g. chilled order onto an ambient truck): blocked with the reason. Make a valid edit.", async () => {});

  // Waits on #49 (dispatcher D3).
  test.fixme("5. Review deferrals: reason codes pre-filled with unavoidable vs choice; outlets skipped yesterday pinned. Publish.", async () => {});

  test("6. Store: receives the deferral notice and ETA band.", async ({ baseURL }) => {
    // Stand-in for steps 3 to 5 until #46 and #49 merge: the plan is published through the API, with the dry order
    // deferred by the dispatcher's choice. Remove it when those steps are real.
    await publishPlanDeferring(baseURL!, placed.dry);

    const { page } = store;
    await page.goto("/store");

    // Two notices arrive with the plan: the deferral, and the ETA of the order that is coming.
    await page.getByRole("button", { name: "Notifications, 2 unread" }).click();
    const notifications = page.getByRole("dialog", { name: "Notifications" });
    await expect(notifications.getByText(`Order ${placed.dry} was deferred`)).toBeVisible();
    await expect(notifications.getByText(`New ETA for order ${placed.chilled}`)).toBeVisible();
    await notifications.getByRole("button", { name: "Close" }).click();

    // My deliveries lists tomorrow's orders: one planned, one moved to the next run.
    await expect(
      page.getByRole("link", { name: new RegExp(`^Chilled · ${placed.chilled} .* Planned$`) }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: new RegExp(`^Dry · ${placed.dry} Moved to Wed 30 Sep · .+ Deferred$`) }),
    ).toBeVisible();

    // The deferral notice: where the order went, why, and when it was due.
    await page.getByRole("button", { name: "View deferral notice" }).click();
    await expect(page.getByRole("heading", { name: "Order timeline" })).toBeVisible();
    await expect(page.getByText(`${placed.dry} · Dry · OUT004`)).toBeVisible();
    await expect(page.getByText("Moved to Wed 30 Sep", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Reason: .+\. It was due Tue 29 Sep\.$/)).toBeVisible();

    // The ETA band of the order that is on the plan: a window, with its trip and stop.
    await page.getByRole("link", { name: "Order tracking" }).click();
    await expect(page.getByText("Next delivery · Tue 29 Sep")).toBeVisible();
    await expect(page.getByText(/^\d{2}:\d{2}–\d{2}:\d{2}$/)).toBeVisible();
    await expect(
      page.getByText(new RegExp(`^Chilled · ${placed.chilled} · Trip T\\d+ · stop \\d+ · 2 units$`)),
    ).toBeVisible();
  });

  // Waits on #52 (loader L1-L3). Runs at the project's Loader width: phone in one run, tablet in the other.
  test.fixme("7. Loader (phone and tablet widths): accept the plan; open the trip; load in reverse stop order; flag a shortfall; hold-to-mark ready.", async () => {});

  // Waits on #53 (driver R1-R3).
  test.fixme("8. Driver: start the run; deliver a stop with proof of delivery.", async () => {});

  // Waits on #53 (driver R1-R3). Goes offline the project's way: the in-app switch in one run, the browser's
  // offline mode in the other (support/offline.ts).
  test.fixme("9. Switch the driver to force-offline; record two more stops offline (pending count visible).", async () => {});

  // Waits on #61 (dispatcher D4).
  test.fixme("10. Dispatcher edits a later stop and cancels a stop the driver already delivered offline. D4 shows the vehicle as no signal / last heard.", async () => {});

  // Waits on #53 (driver R1-R3).
  test.fixme("11. Driver reconnects: sync progress, plan-changed acknowledgement, and a clash card for the cancelled-but-delivered stop.", async () => {});

  // Waits on #61 (dispatcher D4 and exceptions inbox).
  test.fixme("12. Dispatcher exceptions inbox shows the clash with the POD photo; resolve it.", async () => {});

  // The screens are merged (#44), but the step needs a delivery at the hill store, which only steps 7 to 11 make
  // (#52, #53): no demo preset reaches it yet (#56).
  test.fixme("13. Store: sees delivered (double timestamp), confirms receipt of one order, reports a shortage on another.", async () => {});

  // Waits on #61 (dispute resolution in D4) and #55 (capacity outlook).
  test.fixme("14. Dispatcher resolves the dispute; opens the capacity outlook.", async () => {});
});
