import type { Page } from "@playwright/test";
import { ACCOUNTS, DEPOTS } from "../support/accounts";
import { STORY } from "../support/demo";
import { expect, test } from "../support/fixtures";
import { goOffline } from "../support/offline";
import { signIn, type RoleWindow } from "../support/signIn";
import { publishDraftDeferring, publishKandyPlan } from "../support/standIns";

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

/**
 * The Driver records the next stop as delivered in full, with proof: arrive, choose the outcome, name the receiver,
 * sign on the glass, save, and go back to the run.
 */
async function deliverNextStop(page: Page, stop: number, outlet: string): Promise<void> {
  await page.getByRole("button", { name: `Go to stop ${stop}` }).click();
  await expect(page.getByRole("heading", { name: `Stop ${stop} · ${outlet}` })).toBeVisible();
  await page.getByRole("button", { name: "Arrived" }).click();
  await page.getByRole("button", { name: /^Delivered in full/ }).click();

  await expect(page.getByRole("heading", { name: `Proof · Stop ${stop}` })).toBeVisible();
  await page.getByLabel("Received by / contact name").fill("Nadeesha");
  const pad = await page.getByLabel("Sign here").boundingBox();
  if (!pad) throw new Error("The signature pad is not on screen");
  await page.mouse.move(pad.x + 20, pad.y + 20);
  await page.mouse.down();
  await page.mouse.move(pad.x + 120, pad.y + 60, { steps: 5 });
  await page.mouse.move(pad.x + 200, pad.y + 30, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Save delivery" }).click();

  await expect(page.getByRole("heading", { name: "Saved on this phone" })).toBeVisible();
  await page.getByRole("button", { name: "Continue the run" }).click();
  await expect(page.getByRole("heading", { name: "Today's run" })).toBeVisible();
}

test.describe("Judge walkthrough (§15.4)", () => {
  let store: RoleWindow;
  let dispatcher: RoleWindow;
  let driver: RoleWindow;
  /** The confirmation IDs from step 1. */
  const placed = { dry: "", chilled: "" };

  test.afterAll(async () => {
    await store?.context.close();
    await dispatcher?.context.close();
    await driver?.context.close();
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

    // The clicks of the README's step 1: one visit to the catalogue, "+" on a dry item, then on the Chilled tab
    // "+" on a chilled item. The chilled item becomes its own order for the same date.
    const increase = (product: string) =>
      page.getByRole("listitem").filter({ hasText: product }).getByRole("button", { name: "Increase quantity" });
    await page.getByRole("link", { name: "Add items from the catalogue" }).click();
    await increase("Rice, 25 kg bag").click();
    await page.getByRole("tab", { name: /^Chilled/ }).click();
    await increase("Fresh milk, crate of 12").click();
    await page.getByRole("button", { name: "Done · 1 item in chilled order" }).click();

    await page.getByRole("button", { name: "Review 2 orders · 2 units" }).click();
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

  test("3. Dispatcher: open the queue; see demand exceed capacity; Propose plan; inspect trips and capacity bars.", async ({
    browser,
  }) => {
    dispatcher = await signIn(browser, ACCOUNTS.dispatcher, { viewport: "desktop" });
    const { page } = dispatcher;
    const main = page.getByRole("main");

    // The peak day is Peliyagoda's, the depot chosen at sign-in, so the workspace opens on it (#131). The selector
    // applies on the first try and the URL follows it.
    const depot = page.getByRole("combobox", { name: "Depot" });
    await expect(page).toHaveURL(/depot=Peliyagoda/);
    await expect(depot).toHaveValue(DEPOTS.peliyagoda);
    await depot.selectOption(DEPOTS.kandy);
    await expect(page).toHaveURL(/depot=Kandy/);
    await depot.selectOption(DEPOTS.peliyagoda);
    await expect(page).toHaveURL(/depot=Peliyagoda/);

    // The queue: the seeded peak day plus the two orders of step 1, and more van-only orders than the vans can
    // take.
    await page.getByRole("link", { name: "Order queue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Order queue" })).toBeVisible();
    await expect(main.getByText("Planning deliveries for Tue 29 Sep · Peliyagoda")).toBeVisible();
    await expect(main.locator("section", { hasText: "Fresh 66 · Style 13 · Tech 9" }).locator("strong")).toHaveText(
      "88",
    );
    const vanOnly = main.locator("section", { hasText: "Van-only orders" });
    await expect(vanOnly.locator("strong")).toHaveText("6");
    await expect(vanOnly).toContainText("2 available vans");

    await page.getByRole("button", { name: "Propose plan" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Draft saved" })).toBeVisible({ timeout: 30_000 });

    // The plan board: the fleet cannot carry everything, so six orders stay unassigned.
    await page.getByRole("link", { name: "Plan board", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Plan board" })).toBeVisible();
    await expect(main.getByText(/^\d+ trips · 82 of 88 orders planned · 6 unassigned/)).toBeVisible();
    await expect(main.getByRole("heading", { name: "Unassigned · 6" })).toBeVisible();

    // A trip and its capacity bars.
    const trip = page.getByRole("article").first();
    await expect(trip.getByRole("heading", { name: "T001 · Trip 1 of 2" })).toBeVisible();
    for (const bar of ["Weight", "Volume", "Time budget", "Weekly fuel used"]) {
      await expect(trip.getByRole("meter", { name: bar, exact: true })).toBeVisible();
    }
  });

  test("4. Attempt a rule-breaking move (e.g. chilled order onto an ambient truck): blocked with the reason. Make a valid edit.", async () => {
    const { page } = dispatcher;
    const main = page.getByRole("main");
    const review = main.locator("section").filter({
      has: page.getByRole("heading", { name: "Attempted edit retained for review" }),
    });

    // The store's chilled order onto an ambient truck: the check names the rule, and the edit cannot be saved.
    const ambient = page.getByRole("article").filter({ hasText: "· Ambient · Fresh" }).first();
    const trip = /^T\d+/.exec((await ambient.getByRole("heading").textContent()) ?? "")?.[0];
    expect(trip, "an ambient Fresh trip on the plan").toBeTruthy();
    await page.getByRole("combobox", { name: `Move to… ${placed.chilled}` }).selectOption(trip!);
    await expect(review.getByText(`Chilled orders need a reefer · ${trip}`)).toBeVisible();
    await expect(review.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await review.getByRole("button", { name: "Cancel" }).click();
    await expect(review).toBeHidden();

    // A valid edit: take the store's dry order off its trip. It passes every check and saves.
    await page.getByRole("combobox", { name: `Move to… ${placed.dry}` }).selectOption("unassigned");
    await expect(review.getByText("All available checks pass")).toBeVisible();
    await review.getByRole("button", { name: "Save changes" }).click();
    await expect(main.getByText(/^\d+ trips · 81 of 88 orders planned · 7 unassigned/)).toBeVisible();
    await expect(main.getByRole("heading", { name: "Unassigned · 7" })).toBeVisible();
  });

  // Waits on #49 (dispatcher D3).
  test.fixme("5. Review deferrals: reason codes pre-filled with unavoidable vs choice; outlets skipped yesterday pinned. Publish.", async () => {});

  test("6. Store: receives the deferral notice and ETA band.", async ({ baseURL }) => {
    // Stand-in for step 5 until #49 merges: the draft of steps 3 and 4 is published through the API, with the dry
    // order the dispatcher took off its trip deferred by choice. Remove it when step 5 is real.
    await publishDraftDeferring(baseURL!, placed.dry);

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
      page.getByText(new RegExp(`^Chilled · ${placed.chilled} · Trip T\\d+ · stop \\d+ · 1 unit$`)),
    ).toBeVisible();
  });

  // Waits on #52 (loader L1-L3). Runs at the project's Loader width: phone in one run, tablet in the other.
  test.fixme("7. Loader (phone and tablet widths): accept the plan; open the trip; load in reverse stop order; flag a shortfall; hold-to-mark ready.", async () => {});

  test("8. Driver: start the run; deliver a stop with proof of delivery.", async ({ browser, demo, baseURL }) => {
    // Stand-ins until #49 and #52 merge. The field steps run on the Kandy hill trip (§15.5): its plan is published
    // through the API, and the trip leaves as planned, without the Loader's step 7 (a departure takes planned
    // orders out, ADR 0019). The clock moves to the delivery morning through the API: no control in the app (#56).
    await publishKandyPlan(baseURL!);
    await demo.setClock(STORY.deliveryDay, "03:25");

    driver = await signIn(browser, ACCOUNTS.driver, { viewport: "phone" });
    const { page } = driver;

    // Today's run: Sampath's reefer truck, the hill trip, four stops.
    await expect(page.getByRole("heading", { name: "VEH039 · Truck" })).toBeVisible();
    await expect(page.getByText(/^Trip T\d+ · Fresh · Kandy · 03:30$/)).toBeVisible();
    await expect(page.getByText("0/4")).toBeVisible();
    await page.getByRole("button", { name: "Start run" }).click();

    await deliverNextStop(page, 1, "OUT105");

    // Online, the record is confirmed at once, and the run shows both times: on the phone, and after sync.
    await expect(page.getByText("1/4")).toBeVisible();
    await expect(page.getByText(/^ORD\d+ · Delivered \d{2}:\d{2} · confirmed \d{2}:\d{2} after sync$/)).toBeVisible();
  });

  test("9. Switch the driver to force-offline; record two more stops offline (pending count visible).", async ({
    offlineMode,
  }) => {
    const { page } = driver;
    // The project's way of losing the connection: the in-app switch in one run, the browser's offline mode in
    // the other (support/offline.ts).
    await goOffline(driver, offlineMode);

    // Stop 2 is the hill store, with two orders recorded one after the other; stop 3 is the next outlet.
    await deliverNextStop(page, 2, "OUT104");
    await deliverNextStop(page, 2, "OUT104");
    await deliverNextStop(page, 3, "OUT106");

    // Nothing is lost and nothing is confirmed yet: the count of deliveries waiting on this phone is in view.
    await expect(page.getByText("Offline — 3 deliveries saved on this phone")).toBeVisible();
    await expect(page.getByText("3/4")).toBeVisible();
  });

  // The D4 screens are merged (#128). Waits on the driver's offline deliveries of steps 8 and 9 (#53).
  test.fixme("10. Dispatcher edits a later stop and cancels a stop the driver already delivered offline. D4 shows the vehicle as no signal / last heard.", async () => {});

  // Waits on #53 (driver R1-R3).
  test.fixme("11. Driver reconnects: sync progress, plan-changed acknowledgement, and a clash card for the cancelled-but-delivered stop.", async () => {});

  // The exceptions inbox is merged (#128). Waits on the clash that steps 9 to 11 make (#53).
  test.fixme("12. Dispatcher exceptions inbox shows the clash with the POD photo; resolve it.", async () => {});

  // The screens are merged (#44), but the step needs a delivery at the hill store, which only steps 7 to 11 make
  // (#52, #53): no demo preset reaches it yet (#56).
  test.fixme("13. Store: sees delivered (double timestamp), confirms receipt of one order, reports a shortage on another.", async () => {});

  // Dispute resolution is merged (#128). Waits on the dispute that step 13 opens and on #55 (capacity outlook).
  test.fixme("14. Dispatcher resolves the dispute; opens the capacity outlook.", async () => {});
});
