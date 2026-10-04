import { describe, expect, it } from "vitest";
import { DEFAULT_DEPOT, homeWithDepot, initialDepot } from "./depot";

describe("the dispatcher's initial depot (#131)", () => {
  const all = ["Kandy", "Peliyagoda"];

  it("opens on the depot chosen at sign-in or by a deep link", () => {
    expect(initialDepot(all, "Kandy")).toBe("Kandy");
    expect(initialDepot(all, "Peliyagoda")).toBe("Peliyagoda");
  });

  it("falls back to Peliyagoda, not the first depot in the list, without a usable choice", () => {
    expect(DEFAULT_DEPOT).toBe("Peliyagoda");
    expect(initialDepot(all, null)).toBe("Peliyagoda");
    expect(initialDepot(all, "Galle")).toBe("Peliyagoda");
  });

  it("uses the account's own depot when it does not cover Peliyagoda", () => {
    expect(initialDepot(["Kandy"], null)).toBe("Kandy");
    expect(initialDepot(["Kandy"], "Peliyagoda")).toBe("Kandy");
  });

  it("carries the chosen depot into the sign-in redirect", () => {
    expect(homeWithDepot("/dispatch", "Kandy")).toBe("/dispatch?depot=Kandy");
    expect(homeWithDepot("/store", undefined)).toBe("/store");
  });
});
