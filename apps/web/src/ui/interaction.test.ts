import { afterEach, describe, expect, it, vi } from "vitest";
import { createHoldController } from "./hold";
import { parseQuantity, nextQuantity } from "./quantity";
import { createDismissTimer } from "./dismissTimer";
afterEach(() => vi.useRealTimers());
describe("hold", () => {
  it("cancels an early release", () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const hold = createHoldController(done);
    hold.start();
    vi.advanceTimersByTime(1199);
    hold.cancel();
    vi.advanceTimersByTime(5000);
    expect(done).not.toHaveBeenCalled();
  });
  it("fires once despite repeated start and ignores disposed starts", () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const hold = createHoldController(done);
    hold.start();
    hold.start();
    vi.advanceTimersByTime(1200);
    hold.start();
    vi.advanceTimersByTime(2000);
    expect(done).toHaveBeenCalledTimes(1);
    hold.cancel();
    hold.start();
    hold.dispose();
    hold.start();
    vi.advanceTimersByTime(5000);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
describe("quantity", () => {
  it("rejects empty, invalid, noninteger and out of bounds edits", () => {
    for (const raw of ["", "NaN", "1.2", "1e2", "-1", "11"]) expect(parseQuantity(raw, 0, 10)).toBeNull();
    expect(parseQuantity("10", 0, 10)).toBe(10);
  });
  it("steps within explicit bounds without emitting invalid numbers", () => {
    expect(nextQuantity(9, 2, 0, 10)).toBe(10);
    expect(nextQuantity(1, -2, 0, 10)).toBe(0);
    expect(nextQuantity(NaN, 1, 0, 10)).toBeNull();
  });
});
describe("dismiss timer", () => {
  it("keeps remaining time while paused and cleans up", () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const timer = createDismissTimer(done, 5000);
    timer.resume();
    vi.advanceTimersByTime(2000);
    timer.pause();
    vi.advanceTimersByTime(9000);
    expect(done).not.toHaveBeenCalled();
    timer.resume();
    vi.advanceTimersByTime(2999);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    timer.resume();
    vi.advanceTimersByTime(5000);
    expect(done).toHaveBeenCalledTimes(1);
    timer.dispose();
  });
  it("disposal cancels pending dismissal", () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const timer = createDismissTimer(done, 5000);
    timer.resume();
    timer.dispose();
    vi.advanceTimersByTime(6000);
    expect(done).not.toHaveBeenCalled();
  });
});

import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { HoldToConfirm } from "./HoldToConfirm";
import { QuantityStepper } from "./QuantityStepper";
import { Modal, Sheet } from "./Overlay";
import { Toast } from "./Toast";
import "../i18n";
describe("interaction semantics", () => {
  it("renders a disabled hold and associated hint without starting a timer", () => {
    const confirm = vi.fn();
    const html = render(
      h(HoldToConfirm, { disabled: true, onConfirm: confirm, children: "Confirm", hint: "Keep pressed" }),
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain("aria-describedby=");
    expect(html).toContain("Keep pressed");
    expect(confirm).not.toHaveBeenCalled();
  });
  it("labels integer input and disables bound buttons", () => {
    const html = render(h(QuantityStepper, { label: "Quantity", value: 0, min: 0, max: 10, onChange: vi.fn() }));
    expect(html).toContain('role="spinbutton"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="10"');
    expect(html).toContain('disabled=""');
    expect(html).toContain("for=");
  });
  it("renders labelled native dialogs and unmounts hidden toast", () => {
    for (const Component of [Modal, Sheet]) {
      const html = render(h(Component, { open: false, onClose: vi.fn(), title: "Review", children: "Content" }));
      expect(html).toContain("<dialog");
      expect(html).toContain("aria-labelledby=");
      expect(html).not.toContain(' open=""');
    }
    expect(render(h(Toast, { open: false, message: "Saved", onClose: vi.fn() }))).toBe("");
  });
  it("separates toast announcement from action controls", () => {
    const html = render(
      h(Toast, { open: true, message: "Saved", action: h("button", null, "Undo"), onClose: vi.fn() }),
    );
    expect(html).toContain('role="status" aria-atomic="true">Saved</div>');
    expect(html).toContain("<button>Undo</button>");
  });
});
