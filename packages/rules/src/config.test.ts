import { describe, expect, it } from "vitest";
import { DEFAULT_RULES_CONFIG, PRIORITY_CLASSES, resolveRulesConfig } from "./config";

describe("RulesConfig", () => {
  it("has the defaults from assumptions.md, config.md and ADRs 0003 and 0009", () => {
    expect(DEFAULT_RULES_CONFIG).toMatchObject({
      cutoffMinute: 960,
      freshFirstDepartureMinute: 210,
      tradingDayStartMinute: 480,
      freshBudgetMin: 270,
      styleTechBudgetMin: 480,
      maxTripsPerVehicle: 2,
      reloadBufferMin: 15,
      fuelIncludeReturn: true,
      etaWindowMin: 30,
      validationEtaIncludesReturn: false,
      agingDeferralCount: 2,
    });
    expect(DEFAULT_RULES_CONFIG.priorityOrder).toEqual([
      "CHILLED_FRESH",
      "OTHER_FRESH",
      "STYLE_TECH_DEFERRED_YESTERDAY",
      "STYLE_TECH_DAYS_SINCE_SERVED",
      "STYLE_TECH_REMAINING",
    ]);
    expect(Object.isFrozen(DEFAULT_RULES_CONFIG)).toBe(true);
  });

  it("applies valid overrides", () => {
    const cfg = resolveRulesConfig({
      validationEtaIncludesReturn: true,
      priorityOrder: [...PRIORITY_CLASSES].reverse(),
    });
    expect(cfg.validationEtaIncludesReturn).toBe(true);
    expect(cfg.priorityOrder[0]).toBe("STYLE_TECH_REMAINING");
  });

  it("rejects inconsistent overrides", () => {
    expect(() => resolveRulesConfig({ priorityOrder: ["CHILLED_FRESH"] })).toThrow(/priorityOrder/);
    expect(() => resolveRulesConfig({ freshBudgetMin: -1 })).toThrow(/freshBudgetMin/);
    expect(() => resolveRulesConfig({ cutoffMinute: 2000 })).toThrow(/cutoffMinute/);
  });
});
