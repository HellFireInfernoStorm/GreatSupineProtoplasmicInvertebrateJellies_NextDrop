import type { Page } from "@playwright/test";
import { ACCOUNTS, DEPOTS } from "../support/accounts";
import { STORY } from "../support/demo";
import { expect, test } from "../support/fixtures";
import { goOffline, goOnline } from "../support/offline";
import { signIn, type RoleWindow } from "../support/signIn";

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

/**
 * The Kandy Loader loads the hill trip on the dock screens: open the trip, check every line in the order shown
 * (last stop first), report one case of biscuits short, wait for the dispatcher's decision on it, then hold to mark
 * the trip ready. It is step 7 without "accept the plan".
 */
async function loadHillTrip(loader: Page, dispatcher: Page): Promise<void> {
  await expect(loader.getByRole("heading", { name: "Dock trips" })).toBeVisible();
  await loader.getByRole("link", { name: "Open ›" }).first().click();
  await expect(loader.getByRole("heading", { name: "Load in this order — last stop first" })).toBeVisible();
  await expect(loader.getByText("Nuwara Eliya · Trip 1")).toBeVisible();

  // Reverse stop order: the last stop goes in first, next to the cab.
  await expect(loader.getByRole("complementary").getByRole("listitem")).toHaveText([
    "OUT107 · Stop 5",
    "OUT106 · Stop 4",
    "OUT104 · Stop 3",
    "OUT104 · Stop 2",
    "OUT105 · Stop 1",
  ]);

  // Every line is checked as loaded, except the biscuits for the hill store: one case is short.
  const lines = loader.locator(".loader-line");
  await expect(lines).toHaveCount(11);
  for (let index = 0; index < 11; index += 1) {
    const line = lines.nth(index);
    if ((await line.textContent())?.includes("Biscuits, case of 36")) {
      await line.getByRole("button", { name: "Short" }).click();
      await loader.getByRole("button", { name: "Out of stock" }).click();
      await loader.getByRole("button", { name: "Save report for dispatcher" }).click();
      await expect(line).toContainText("1 short");
    } else {
      await line.getByRole("button", { name: "Loaded" }).click();
      await expect(line).toContainText("Checked");
    }
  }
  await expect(loader.getByText("5 of 5 checked")).toBeVisible();

  // The shortfall holds the trip at the dock until the dispatcher decides.
  await loader.getByRole("link", { name: /^Review & mark ready/ }).click();
  await expect(loader.getByText("Biscuits, case of 36 · 1 short · Waiting on dispatcher")).toBeVisible();
  const hold = loader.getByRole("button", { name: /^Hold to mark ready/ });
  await expect(hold).toBeDisabled();

  await dispatcher.getByRole("link", { name: "Delivery Progress", exact: true }).click();
  await dispatcher.getByRole("tab", { name: /^Shortfalls/ }).click();
  await dispatcher.getByRole("button", { name: /Short 1 of Biscuits, case of 36/ }).click();
  const decision = dispatcher.getByRole("region", { name: /^Short at the dock/ });
  await expect(decision.getByRole("radio", { name: /^Ship partial/ })).toBeChecked();
  await decision.getByRole("button", { name: "Confirm decision" }).click();
  await expect(dispatcher.getByRole("status").filter({ hasText: "ships partial" })).toBeVisible();

  // The decision reaches the dock, and the Loader hands the truck over by holding the button.
  await expect(loader.getByText("Biscuits, case of 36 · 1 short · Ship partial · approved")).toBeVisible();
  await expect(hold).toBeEnabled();
  const button = await hold.boundingBox();
  if (!button) throw new Error("The hold-to-mark-ready button is not on screen");
  await loader.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
  await loader.mouse.down();
  await loader.waitForTimeout(1_600);
  await loader.mouse.up();
  await expect(loader.getByText("Handed over to driver")).toBeVisible();
}

test.describe("Judge walkthrough (§15.4)", () => {
  let store: RoleWindow;
  let dispatcher: RoleWindow;
  let driver: RoleWindow;
  let loader: RoleWindow;
  let hillStore: RoleWindow;
  /** The confirmation IDs from step 1. */
  const placed = { dry: "", chilled: "" };

  test.afterAll(async () => {
    await store?.context.close();
    await dispatcher?.context.close();
    await driver?.context.close();
    await loader?.context.close();
    await hillStore?.context.close();
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

    // A valid edit: take the store's dry order off its trip. ETA warnings remain non-blocking.
    await page.getByRole("combobox", { name: `Move to… ${placed.dry}` }).selectOption("unassigned");
    await expect(review.getByText(/^Constraints pass · \d+ warnings? to review$/)).toBeVisible();
    await expect(review.getByRole("button", { name: "Save changes" })).toBeEnabled();
    await review.getByRole("button", { name: "Save changes" }).click();
    await expect(main.getByText(/^\d+ trips · 81 of 88 orders planned · 7 unassigned/)).toBeVisible();
    await expect(main.getByRole("heading", { name: "Unassigned · 7" })).toBeVisible();
  });

  test("5. Review deferrals: reason codes pre-filled with unavoidable vs choice; outlets skipped yesterday pinned. Publish.", async () => {
    const { page } = dispatcher;
    const main = page.getByRole("main");
    const publish = main.getByRole("complementary").filter({
      has: page.getByRole("heading", { name: "Publish Tue 29 Sep plan" }),
    });
    await page.getByRole("link", { name: /Review deferrals & publish/ }).click();
    await expect(page.getByRole("heading", { name: "Defer & publish" })).toBeVisible();

    // Outlets skipped on the previous run are pinned first. This plan serves every one of them.
    await expect(main.getByRole("heading", { name: "Previously deferred · prioritised first" })).toBeVisible();
    await expect(main.getByText(/^\d+ now planned · 0 deferred again$/)).toBeVisible();

    // The six orders the fleet could not carry have their reason filled in, and are marked unavoidable.
    const unavoidable = main.getByRole("row").filter({ hasText: "Unavoidable · available pool exhausted" });
    await expect(unavoidable).toHaveCount(6);
    await expect(unavoidable.first().getByRole("combobox").locator("option:checked")).toHaveText(/\S/);
    await expect(unavoidable.first().getByRole("cell", { name: "Ready" })).toBeVisible();

    // The order the dispatcher took off its trip in step 4 is a choice, and a choice needs a justification.
    const choice = main.getByRole("row").filter({ hasText: placed.dry });
    await expect(choice).toContainText("Choice · a feasible slot existed");
    await expect(
      choice.getByRole("combobox", { name: `Reason for ${placed.dry}` }).locator("option:checked"),
    ).toHaveText("Other");
    await expect(publish.getByText("6 of 7 reasons set")).toBeVisible();
    await expect(publish.getByRole("button", { name: "Publish plan" })).toBeDisabled();
    await choice.getByRole("textbox").fill("Store agreed to take the dry order with Wednesday's run");
    await expect(publish.getByText("7 of 7 reasons set")).toBeVisible();

    await publish.getByRole("button", { name: "Publish plan" }).click();
    await expect(main.getByRole("listitem").getByText(/Version 1 · 81 served · 7 deferred · \d+ trips/)).toBeVisible();

    // The field steps follow the Kandy hill trip (§15.5), so the dispatcher switches depot and publishes that plan
    // too: every Kandy order fits, nothing is deferred.
    await page.getByRole("combobox", { name: "Depot" }).selectOption(DEPOTS.kandy);
    await expect(page).toHaveURL(/depot=Kandy/);
    await page.getByRole("link", { name: "Plan board", exact: true }).click();
    await page.getByRole("button", { name: "Propose plan" }).click();
    await expect(main.getByText(/^\d+ trips · 8 of 8 orders planned · 0 unassigned/)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("link", { name: /Review deferrals & publish/ }).click();
    await expect(main.getByText("Every order is assigned to a trip.")).toBeVisible();
    await publish.getByRole("button", { name: "Publish plan" }).click();
    await expect(main.getByRole("listitem").getByText(/Version 1 · 8 served · 0 deferred · \d+ trips/)).toBeVisible();
  });

  test("6. Store: receives the deferral notice and ETA band.", async () => {
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

  // The Loader's screens are merged (#52), and `loadHillTrip` does every part of this step but the first: "accept
  // the plan". The Loader app asks for a plan to be accepted only when a changed plan reaches a device that has
  // already seen one; the first published plan needs no acceptance, so the step cannot be done as §15.4 words it.
  // To be settled with the Loader's owner. Until then step 8 calls loadHillTrip as a stand-in.
  test.fixme("7. Loader (phone and tablet widths): accept the plan; open the trip; load in reverse stop order; flag a shortfall; hold-to-mark ready.", async () => {});

  test("8. Driver: start the run; deliver a stop with proof of delivery.", async ({
    browser,
    demo,
    loaderViewport,
  }) => {
    // Stand-in for step 7: before the truck leaves, the Kandy Loader loads it through the dock screens, at the
    // project's Loader width (phone in one run, tablet in the other). The clock moves through the API, first to the
    // loading hour and then to the departure: the app has no clock control (#56).
    await demo.setClock(STORY.deliveryDay, "02:45");
    loader = await signIn(browser, ACCOUNTS.kandyLoader, { viewport: loaderViewport });
    await loadHillTrip(loader.page, dispatcher.page);
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

  test("10. Dispatcher edits a later stop and cancels a stop the driver already delivered offline. D4 shows the vehicle as no signal / last heard.", async ({
    demo,
  }) => {
    // Twenty minutes into the run, through the API (#56): the truck has not been heard from since stop 1.
    await demo.setClock(STORY.deliveryDay, "03:45");
    const { page } = dispatcher;
    const main = page.getByRole("main");
    const review = main.locator("section").filter({
      has: page.getByRole("heading", { name: "Attempted edit retained for review" }),
    });
    const publish = main.getByRole("complementary").filter({
      has: page.getByRole("heading", { name: "Publish Tue 29 Sep plan" }),
    });

    // The Kandy plan board still shows the trip that has left. Stop 1 was delivered and confirmed, so it is locked.
    // The dispatcher knows nothing of the three deliveries waiting on the driver's phone.
    await page.getByRole("link", { name: "Plan board", exact: true }).click();
    const hillTrip = page.getByRole("article").filter({ hasText: "VEH039" });
    await expect(hillTrip.getByText("Departs 03:30 · 5 stops")).toBeVisible();
    await expect(hillTrip.getByRole("combobox", { name: "Move to… ORD10490" })).toBeDisabled();
    await expect(hillTrip.getByText("4 · OUT106 Waypoint Fresh, Nuwara Eliya")).toBeVisible();
    await expect(hillTrip.getByText("5 · OUT107 Waypoint Fresh, Nuwara Eliya")).toBeVisible();

    // Cancel the OUT106 stop, which the driver has in fact already delivered offline. Taking it off the trip also
    // edits the stop after it: OUT107 moves up to fourth, with a new ETA.
    await hillTrip.getByRole("combobox", { name: "Move to… ORD10491" }).selectOption("unassigned");
    await expect(review.getByText("All available checks pass")).toBeVisible();
    await review.getByRole("button", { name: "Save changes" }).click();
    await expect(main.getByText(/^\d+ trips · 7 of 8 orders planned · 1 unassigned/)).toBeVisible();
    await expect(hillTrip.getByText("4 · OUT107 Waypoint Fresh, Nuwara Eliya")).toBeVisible();

    // Publish the change: the removed order needs its reason first.
    await page.getByRole("link", { name: /Review deferrals & publish/ }).click();
    const removed = main.getByRole("row").filter({ hasText: "ORD10491" });
    await removed.getByRole("textbox").fill("Store asked to take this order with Wednesday's run");
    await expect(publish.getByText("1 of 1 reasons set")).toBeVisible();
    await publish.getByRole("button", { name: "Publish plan" }).click();
    await expect(main.getByRole("listitem").getByText(/Version 2 · 7 served · 1 deferred · \d+ trips/)).toBeVisible();

    // Delivery Progress: the truck is not late, it is out of signal, with the time it was last heard.
    await page.getByRole("link", { name: "Delivery Progress", exact: true }).click();
    const card = main.getByRole("article").filter({ hasText: "VEH039" });
    await expect(card.getByText("No signal", { exact: true })).toBeVisible();
    await expect(card.getByText(/^Last heard 03:2\d · \d+ min ago · stop 1 of 4/)).toBeVisible();
    await expect(card.getByText("Records sync when signal returns. Not late, just out of signal.")).toBeVisible();
  });

  test("11. Driver reconnects: sync progress, plan-changed acknowledgement, and a clash card for the cancelled-but-delivered stop.", async ({
    offlineMode,
  }) => {
    const { page } = driver;
    // Back in coverage, the project's way: the in-app switch off in one run, the browser back online in the other.
    await goOnline(driver, offlineMode);

    // The three deliveries reach the server. Two are confirmed; the third is for the stop that was cancelled, so
    // the phone says it needs the dispatcher.
    await page.getByRole("link", { name: "Needs dispatch" }).click();
    // The held record shows at once; its details follow with the next sync, which "Sync now" asks for.
    await expect(async () => {
      const syncNow = page.getByRole("button", { name: "Sync now" });
      if (await syncNow.isVisible()) await syncNow.click();
      await expect(page.getByRole("heading", { name: "All synced" })).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });

    // The clash card: nothing is resolved by itself, and both records are kept side by side.
    await expect(page.getByRole("status").filter({ hasText: "Clash — both records kept" })).toContainText("OUT106");
    const record = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Your record" }) });
    await expect(record.getByText("Delivered in full")).toBeVisible();
    await expect(record.getByText(/^Captured \d{2}:\d{2} on phone$/).first()).toBeVisible();
    await expect(record.getByText(/^Received \d{2}:\d{2} by server$/).first()).toBeVisible();
    await expect(record.getByRole("img", { name: "Saved proof image" })).toBeVisible();
    const change = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Dispatch change" }) });
    await expect(change.getByText("Stop deferred")).toBeVisible();
    await expect(change.getByText("Plan 1 → 2")).toBeVisible();
    await expect(page.getByText("Sent to dispatch's exceptions inbox")).toBeVisible();

    // The plan-changed acknowledgement: review the stops of the new plan, then accept it.
    const changed = page.getByRole("dialog", { name: "Your run changed" });
    if (!(await changed.isVisible())) await page.getByRole("button", { name: "Review plan" }).click();
    await expect(changed.getByText("Review your current stops on plan 2 before acknowledging.")).toBeVisible();
    await expect(changed.getByText("4 · OUT107 · Nuwara Eliya")).toBeVisible();
    await changed.getByRole("button", { name: "Got it" }).click();
    await expect(changed).toBeHidden();

    // The run now follows the new plan: three stops, two of them done, with both times on the synced deliveries.
    await page.getByRole("button", { name: "OK, back to run" }).click();
    await expect(page.getByText("2/3")).toBeVisible();
    await expect(page.getByText(/^ORD10412 · Delivered \d{2}:\d{2} · confirmed \d{2}:\d{2} after sync$/)).toBeVisible();
  });

  test("12. Dispatcher exceptions inbox shows the clash with the POD photo; resolve it.", async () => {
    const { page } = dispatcher;
    const main = page.getByRole("main");

    // The dispatcher reopens Delivery Progress. It was left open in step 10 and showed the clash the moment the
    // driver's text records arrived, before the proof image had uploaded: an evidence panel opened that early keeps
    // saying "No photo" until the page is opened again.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Delivery Progress" })).toBeVisible();

    // The cancelled-but-delivered stop is in the inbox, once for each record the driver's phone held for it: the
    // arrival, the outcome and the proof of delivery.
    const clash = page.getByRole("region", { name: "Sync clash · ORD10491" });
    await expect(page.getByRole("tab", { name: /^Sync clashes 3$/ })).toBeVisible();
    await page.getByRole("tab", { name: /^Sync clashes 3$/ }).click();
    await main
      .getByRole("tabpanel")
      .getByRole("button", { name: /^ORD10491 · OUT106/ })
      .first()
      .click();

    // The evidence: what clashed, and the driver's proof-of-delivery image beside the plan change.
    await expect(clash.getByText("OUT106 Waypoint Fresh, Nuwara Eliya · T043 · VEH039 · chilled")).toBeVisible();
    await expect(
      clash.getByRole("definition").filter({ hasText: "Delivered offline, but the stop was cancelled" }),
    ).toBeVisible();
    await expect(clash.getByRole("img", { name: "Driver proof of delivery 1" })).toBeVisible();

    // Resolve it: the driver's fact stands. Each of the three held records is accepted in turn.
    for (let left = 3; left > 0; left -= 1) {
      await main
        .getByRole("tabpanel")
        .getByRole("button", { name: /^ORD10491 · OUT106/ })
        .first()
        .click();
      await clash.getByRole("button", { name: "Accept fact" }).click();
      await expect(page.getByRole("tab", { name: new RegExp(`^Sync clashes ${left - 1}$`) })).toBeVisible();
    }
    await expect(
      page.getByRole("status").filter({ hasText: "Delivery fact accepted for ORD10491" }).first(),
    ).toBeVisible();
  });

  test("13. Store: sees delivered (double timestamp), confirms receipt of one order, reports a shortage on another.", async ({
    browser,
  }) => {
    // Ishara, the hill store's manager, on a phone. Both orders were handed over while the driver was out of
    // coverage, so each shows two times: on the driver's phone, and when the record reached the server.
    hillStore = await signIn(browser, ACCOUNTS.hillStore, { viewport: "phone" });
    const { page } = hillStore;
    await expect(page.getByText("Trip T043 · you are stop 2")).toBeVisible();
    await expect(page.getByText(/Delivered \d{2}:\d{2} on the driver's phone/)).toBeVisible();
    await expect(page.getByText(/Confirmed \d{2}:\d{2} after sync/)).toBeVisible();

    // The chilled order came in full: confirm it with the counts pre-filled from the driver's record.
    await page.getByRole("button", { name: "Confirm delivery" }).click();
    await expect(page.getByRole("heading", { name: "Confirm receipt" })).toBeVisible();
    await expect(page.getByText("ORD10412 · Chilled")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pre-filled from the driver's record" })).toBeVisible();
    await expect(page.getByText("Signed by Nadeesha")).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: /Received quantity of Eggs/ })).toHaveValue("8");
    await expect(page.getByRole("spinbutton", { name: /Received quantity of Fresh milk/ })).toHaveValue("12");
    await page.getByRole("button", { name: "Received as delivered" }).click();
    await expect(page.getByRole("heading", { name: "Order timeline" })).toBeVisible();
    await expect(page.getByText("ORD10412 · Chilled · OUT104")).toBeVisible();
    await expect(page.getByText("20 units received")).toBeVisible();
    await expect(page.getByText("8 ordered · 8 delivered · 8 received")).toBeVisible();

    // The dry order: the store counts one case of tea fewer than the driver recorded, and reports the shortage.
    await page.goto("/store");
    await page.getByRole("link", { name: /^Dry · ORD10468/ }).click();
    await expect(page.getByText("ORD10468 · Dry · OUT104")).toBeVisible();
    await page.getByRole("button", { name: "Report an issue" }).click();
    await expect(page.getByRole("heading", { name: "Report an issue" })).toBeVisible();
    await page.getByRole("radio", { name: "Short" }).check();
    await page.getByRole("combobox", { name: "Item" }).selectOption({ label: "Tea, case of 24 × 400 g · case" });
    await expect(page.getByRole("spinbutton", { name: /^How many of Tea/ })).toHaveValue("1");
    await expect(page.getByText("of 6 delivered")).toBeVisible();
    await page.getByRole("button", { name: "Send to dispatcher" }).click();

    // The order is now disputed, and the report is with the dispatcher.
    await expect(page.getByRole("heading", { name: "Order timeline" })).toBeVisible();
    await expect(page.getByText("ORD10468 · Dry · OUT104")).toBeVisible();
    await expect(page.getByText("Disputed", { exact: true }).first()).toBeVisible();
  });

  test("14. Dispatcher resolves the dispute; opens the capacity outlook.", async () => {
    const { page } = dispatcher;
    const main = page.getByRole("main");

    // The store's report is in the inbox, with the driver's proof of delivery and both delivery times beside it.
    await page.getByRole("tab", { name: /^Disputes 1$/ }).click();
    await main
      .getByRole("tabpanel")
      .getByRole("button", { name: /^ORD10468 · OUT104/ })
      .click();
    const dispute = page.getByRole("region", { name: "Reported issue · ORD10468" });
    await expect(dispute.getByText("Disputed", { exact: true })).toBeVisible();
    await expect(dispute.getByRole("definition").filter({ hasText: /^Short delivery · / })).toBeVisible();
    await expect(dispute.getByRole("img", { name: "Driver proof of delivery 1" })).toBeVisible();
    await expect(dispute.getByRole("definition").filter({ hasText: /on the driver's phone$/ })).toBeVisible();
    await expect(dispute.getByRole("definition").filter({ hasText: /after sync$/ })).toBeVisible();

    // Resolve it: the store is credited for the missing case.
    await dispute.getByRole("button", { name: "Credit" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Credit recorded for ORD10468" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /^Disputes 0$/ })).toBeVisible();

    // The capacity outlook: weekly demand against the depot's fleet capacity, as a chart and as a table.
    await page.getByRole("link", { name: "Capacity outlook", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Capacity outlook" })).toBeVisible();
    await expect(
      main.getByRole("img", { name: /^Weekly demand in m³ against a fleet capacity of [\d,.]+ m³$/ }),
    ).toBeVisible();
    const weeks = main.getByRole("table", { name: "Weekly demand and capacity (m³)" }).getByRole("rowheader");
    await expect(weeks.first()).toHaveText(/^2026-W\d{2}$/);
    expect(await weeks.count()).toBeGreaterThanOrEqual(12);
  });
});
