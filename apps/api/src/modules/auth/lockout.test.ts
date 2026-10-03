import { describe, expect, it } from "vitest";
import { createLockout } from "./lockout";

describe("login lockout backoff", () => {
  const config = { threshold: 3, baseMs: 1000, maxMs: 5000 };

  it("locks after the threshold and doubles each further failure up to the cap", () => {
    let t = 0;
    const lockout = createLockout(config, () => t);
    expect([lockout.fail("k"), lockout.fail("k"), lockout.fail("k")]).toEqual([0, 0, 0]);
    expect(lockout.retryAfterMs("k")).toBe(0);
    expect(lockout.fail("k")).toBe(1000);
    expect(lockout.retryAfterMs("k")).toBe(1000);
    t += 400;
    expect(lockout.retryAfterMs("k")).toBe(600);
    expect(lockout.fail("k")).toBe(2000);
    expect(lockout.fail("k")).toBe(4000);
    expect(lockout.fail("k")).toBe(5000);
    expect(lockout.fail("k")).toBe(5000);
    t += 5000;
    expect(lockout.retryAfterMs("k")).toBe(0);
  });

  it("keeps keys independent and resets on success", () => {
    const lockout = createLockout(config, () => 0);
    for (let i = 0; i < 4; i++) lockout.fail("a");
    expect(lockout.retryAfterMs("a")).toBeGreaterThan(0);
    expect(lockout.retryAfterMs("b")).toBe(0);
    lockout.succeed("a");
    expect(lockout.retryAfterMs("a")).toBe(0);
    expect(lockout.fail("a")).toBe(0);
  });
});
