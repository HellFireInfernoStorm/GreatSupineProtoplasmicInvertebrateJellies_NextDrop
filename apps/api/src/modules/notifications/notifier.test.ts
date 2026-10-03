import { describe, expect, it } from "vitest";
import { groupOf, NOTIFICATION_GROUPS } from "./index";

describe("notification groups", () => {
  it("maps every kind to a popover group", () => {
    for (const group of Object.values(NOTIFICATION_GROUPS)) {
      expect(["DELIVERIES", "PLANNING", "NEEDS_ACTION"]).toContain(group);
    }
    expect(groupOf("plan_changed")).toBe("PLANNING");
    expect(groupOf("delivered")).toBe("DELIVERIES");
    expect(groupOf("vehicle_breakdown")).toBe("NEEDS_ACTION");
  });

  it("surfaces an unknown stored kind as needing action rather than hiding it", () => {
    expect(groupOf("something_new")).toBe("NEEDS_ACTION");
    expect(groupOf("toString")).toBe("NEEDS_ACTION");
  });
});
