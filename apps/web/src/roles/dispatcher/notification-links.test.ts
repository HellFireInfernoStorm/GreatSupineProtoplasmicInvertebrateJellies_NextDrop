import { describe, expect, it } from "vitest";
import { notificationLink } from "./notification-links";
describe("dispatcher notification destinations", () => {
  it("links planning, vehicle and trip entities to their resolution screen", () => {
    expect(notificationLink({ type: "trip", id: "T001" })).toBe("/dispatch/runs?trip=T001");
    expect(notificationLink({ type: "vehicle", id: "VEH001" })).toBe("/dispatch/fleet?vehicle=VEH001");
    expect(notificationLink({ type: "planning_day", id: "2026-10-03" })).toBe("/dispatch/plan?day=2026-10-03");
  });
  it("encodes identifiers and refuses arbitrary destinations", () => {
    expect(notificationLink({ type: "order", id: "a&b" })).toBe("/dispatch/queue?order=a%26b");
    expect(notificationLink({ type: "https://evil.test", id: "x" })).toBeNull();
  });
  it("uses notification dates instead of interpreting planning day UUIDs as dates", () => {
    expect(notificationLink({ type: "planningDay", id: "uuid" }, "orders_closed", "2026-10-05")).toBe(
      "/dispatch/plan?day=2026-10-05",
    );
    expect(notificationLink({ type: "planningDay", id: "uuid" })).toBe("/dispatch/plan?planningDay=uuid");
    expect(notificationLink({ type: "planningDay", id: "uuid" }, "orders_closed", "2026-10-05", "Kandy")).toBe(
      "/dispatch/plan?day=2026-10-05&depot=Kandy",
    );
    expect(notificationLink({ type: "order", id: "order" }, "short_reported")).toBe("/dispatch/runs?order=order");
    expect(notificationLink({ type: "order", id: "order" }, "deferral_notice")).toBe("/dispatch/defer?order=order");
  });
});
