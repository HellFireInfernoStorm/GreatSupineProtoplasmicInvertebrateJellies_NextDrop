import { apiVariantFixtures, HUMAN_ROLES, loginRequestSchema } from "@nextdrop/contracts";
import { describe, expect, it } from "vitest";
import { ApiRequestError } from "../lib/api";
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

  // Until the seed (#30) supplies real accounts, the chips must sign in with the logins the mock accepts.
  it("matches the contract login fixtures", () => {
    const deviceId = apiVariantFixtures.loginRequest.LOADER.deviceId;
    for (const account of DEMO_ACCOUNTS) {
      expect(account.request(deviceId)).toEqual(apiVariantFixtures.loginRequest[account.role]);
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
