// Manual real-browser regression runner: /ui-review.html. Not imported by the application.
import { StrictMode, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { Modal, Sheet } from "./Overlay";
import { HoldToConfirm } from "./HoldToConfirm";
import { Toast } from "./Toast";
import { Instant } from "./Timeline";
import { restoreClockOffset } from "../lib/clock";
import "../i18n";
import "../index.css";

const fixture = document.querySelector<HTMLDivElement>("#fixture")!;
const results = document.querySelector<HTMLOListElement>("#results")!;
let root: Root;
const wait = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};
const mount = async (node: ReturnType<typeof h>) => {
  if (root) flushSync(() => root.unmount());
  root = createRoot(fixture);
  flushSync(() => root.render(node));
  await wait();
};
const check = async (name: string, run: () => Promise<void>) => {
  const row = document.createElement("li");
  results.append(row);
  try {
    await run();
    row.textContent = `PASS: ${name}`;
    row.dataset.result = "pass";
  } catch (error) {
    row.textContent = `FAIL: ${name}: ${String(error)}`;
    row.dataset.result = "fail";
  }
};
let closes = 0;
const overlay = (Component = Modal, open = true) =>
  h(Component, {
    open,
    title: "Review",
    onClose: () => {
      closes++;
    },
    children: h("input", { type: "file", "aria-label": "Photo" }),
  });
for (const Component of [Modal, Sheet])
  await check(`${Component.name} mounted open under StrictMode`, async () => {
    closes = 0;
    await mount(h(StrictMode, null, overlay(Component)));
    assert(fixture.querySelector("dialog")!.open && closes === 0, `spurious close callbacks: ${closes}`);
  });
await check("close/reopen ignores the previous queued close", async () => {
  closes = 0;
  await mount(overlay());
  flushSync(() => root.render(overlay(Modal, false)));
  flushSync(() => root.render(overlay()));
  await wait();
  assert(closes === 0 && fixture.querySelector("dialog")!.open, `spurious close callbacks: ${closes}`);
});
await check("file input cancel leaves its dialog open", async () => {
  closes = 0;
  await mount(overlay(Sheet));
  fixture.querySelector("input")!.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }));
  await wait();
  assert(closes === 0, "file cancel dismissed report");
});
await check("drag from content onto backdrop does not dismiss", async () => {
  closes = 0;
  await mount(overlay());
  fixture.querySelector("input")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  fixture.querySelector("dialog")!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 0, clientY: 0 }));
  assert(closes === 0, "content drag dismissed report");
});
await check("a backdrop press and click dismiss once", async () => {
  closes = 0;
  await mount(overlay());
  const dialog = fixture.querySelector("dialog")!;
  dialog.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0 }));
  dialog.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 0, clientY: 0 }));
  assert(closes === 1, `close callbacks: ${closes}`);
});
await check("dialog's own cancel still dismisses", async () => {
  closes = 0;
  await mount(overlay());
  fixture.querySelector("dialog")!.dispatchEvent(new Event("cancel", { bubbles: false, cancelable: true }));
  assert(closes === 1, `close callbacks: ${closes}`);
});
await check("moving a captured hold outside cancels confirmation", async () => {
  let confirmed = 0;
  await mount(h(HoldToConfirm, { onConfirm: () => confirmed++, children: "Ready" }));
  const button = fixture.querySelector<HTMLButtonElement>(".nd-hold")!;
  // Synthetic pointer IDs aren't active in Chromium. Stub only capture acquisition, not handlers/timers.
  button.setPointerCapture = () => {};
  const rect = button.getBoundingClientRect();
  button.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: 1,
      button: 0,
      clientX: rect.left + 5,
      clientY: rect.top + 5,
    }),
  );
  button.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: rect.right + 20, clientY: rect.top + 5 }),
  );
  await wait(1350);
  assert(confirmed === 0, "outside hold confirmed");
});
await check("assistive click requires a separate explicit confirmation", async () => {
  let confirmed = 0;
  await mount(h(HoldToConfirm, { onConfirm: () => confirmed++, children: "Ready" }));
  fixture.querySelector<HTMLButtonElement>(".nd-hold")!.click();
  await wait();
  const dialog = fixture.querySelector<HTMLDialogElement>("dialog");
  assert(confirmed === 0 && !!dialog?.open, "confirmation alternative missing or immediate");
  dialog!.querySelector<HTMLButtonElement>(".nd-overlay-body button")!.click();
  await wait();
  assert(confirmed === 1, "explicit confirmation failed");
});
await check("replacement toast gets its own full duration", async () => {
  let dismissed = 0;
  const toast = (message: string) => h(Toast, { open: true, message, durationMs: 800, onClose: () => dismissed++ });
  await mount(toast("First"));
  await wait(450);
  flushSync(() => root.render(toast("Second")));
  await wait(450);
  assert(dismissed === 0, "old timer dismissed replacement");
  await wait(450);
  assert(dismissed === 1, `dismiss callbacks: ${dismissed}`);
});
await check("server clock correction updates today's timestamp label", async () => {
  try {
    restoreClockOffset(Date.parse("2026-10-04T03:00:00Z") - Date.now());
    await mount(h(Instant, { instant: "2026-10-03T18:00:00Z" }));
    assert(fixture.textContent!.includes("Sat 3 Oct"), "older day omitted");
    restoreClockOffset(Date.parse("2026-10-03T17:00:00Z") - Date.now());
    await wait();
    assert(!fixture.textContent!.includes("Sat 3 Oct"), "day did not react to server correction");
  } finally {
    restoreClockOffset(0);
  }
});
await check("disable/re-enable discards an accessible confirmation request", async () => {
  const hold = (disabled: boolean) => h(HoldToConfirm, { disabled, onConfirm: () => {}, children: "Ready" });
  await mount(hold(false));
  fixture.querySelector<HTMLButtonElement>(".nd-hold")!.click();
  await wait();
  flushSync(() => root.render(hold(true)));
  await wait();
  flushSync(() => root.render(hold(false)));
  await wait();
  assert(!fixture.querySelector<HTMLDialogElement>("dialog")!.open, "stale confirmation reopened");
});
flushSync(() => root.unmount());
document.title = `UI regressions: ${results.querySelectorAll('[data-result="fail"]').length} failures`;
