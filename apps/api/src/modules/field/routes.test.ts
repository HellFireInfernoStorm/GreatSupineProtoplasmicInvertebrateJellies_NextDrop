import { apiRoutes, type HumanRole } from "@nextdrop/contracts";
import { describe, expect, it } from "vitest";
import { reasonLists } from "./config";

describe("field routes", () => {
  it("lets field roles mutate only through /sync/* (plus their own session and notification read state)", () => {
    const allowed = new Set(["login", "logout", "reauth", "notificationsRead"]);
    const fieldMutations = Object.entries(apiRoutes).filter(
      ([name, route]) =>
        route.method !== "GET" &&
        !allowed.has(name) &&
        (route.roles as readonly HumanRole[]).some((role) => role === "LOADER" || role === "DRIVER"),
    );
    expect(fieldMutations.map(([, route]) => route.path).sort()).toEqual([
      "/api/sync/blobs/:id",
      "/api/sync/events",
      "/api/sync/heartbeat",
    ]);
  });

  it("gives every reason an i18n key named after its list and code", () => {
    for (const [group, items] of Object.entries(reasonLists())) {
      for (const item of items) expect(item.message_key).toBe(`${group}.${item.code}`);
    }
  });
});
