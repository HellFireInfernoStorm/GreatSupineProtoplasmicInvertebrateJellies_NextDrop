import { apiVariantFixtures, HUMAN_ROLES, loginRequestSchema } from "@nextdrop/contracts";
import { describe, expect, it } from "vitest";
import { ApiRequestError } from "../lib/api";
import { MOCK_LOCKED_SECRETS, MOCK_WRONG_SECRETS } from "../lib/api/mock";
import { DEMO_ACCOUNTS } from "./demoAccounts";
import { loginFailureOf } from "./useLogin";

describe("demo accounts", () => {
  it("has one account per role, each a valid login request", () => {
    expect(DEMO_ACCOUNTS.map((account) => account.role)).toEqual([...HUMAN_ROLES]);
    const deviceId = apiVariantFixtures.loginRequest.LOADER.deviceId;
    for (const account of DEMO_ACCOUNTS) {
      expect(loginRequestSchema.safeParse(account.request(deviceId)).success, account.role).toBe(true);
    }
  });

  it("signs in through mock mode, so the chips work without an API", () => {
    const deviceId = apiVariantFixtures.loginRequest.LOADER.deviceId;
    for (const account of DEMO_ACCOUNTS) {
      const secret = account.request(deviceId);
      const value = "pin" in secret ? secret.pin : secret.password;
      expect([...MOCK_WRONG_SECRETS, ...MOCK_LOCKED_SECRETS], account.role).not.toContain(value);
    }
  });
});

describe("login failures", () => {
  it("words each kind of failure the way the login screens show it", () => {
    expect(loginFailureOf(new ApiRequestError("http", 401, null, ""))).toBe("invalid");
    expect(loginFailureOf(new ApiRequestError("http", 429, null, ""))).toBe("locked");
    expect(loginFailureOf(new ApiRequestError("http", 403, null, ""))).toBe("forbidden");
    expect(loginFailureOf(new ApiRequestError("network", null, null, ""))).toBe("network");
    expect(loginFailureOf(new ApiRequestError("http", 500, null, ""))).toBe("unknown");
    expect(loginFailureOf(new Error("boom"))).toBe("unknown");
  });
});
