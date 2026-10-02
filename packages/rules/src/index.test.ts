import { describe, expect, it } from "vitest";
import * as rules from "./index";
import pkg from "../package.json" with { type: "json" };

describe("@nextdrop/rules", () => {
  it("counts a day in integer minutes", () => {
    expect(rules.MINUTES_PER_DAY).toBe(1440);
  });

  it("has zero runtime dependencies", () => {
    expect(pkg).not.toHaveProperty("dependencies");
  });
});
