import { HUMAN_ROLES } from "@nextdrop/contracts";
import { describe, expect, it } from "vitest";
import { guardLogin, guardRole, roleFromSlug, ROLE_PATHS } from "./roles";

describe("route guards", () => {
  it("sends a signed-out visitor to the login screen of the role they opened", () => {
    expect(guardRole(null, "DRIVER")).toBe("/login/driver");
    expect(guardRole(null, "DISPATCHER")).toBe("/login/dispatch");
  });

  it("lets a role into its own routes", () => {
    for (const role of HUMAN_ROLES) expect(guardRole(role, role)).toBeNull();
  });

  it("sends a role that opens another role's routes back to its own home", () => {
    expect(guardRole("STORE", "DISPATCHER")).toBe("/store");
    expect(guardRole("LOADER", "DRIVER")).toBe("/loader");
  });

  it("shows a login screen only to a signed-out visitor", () => {
    expect(guardLogin(null)).toBeNull();
    expect(guardLogin("DISPATCHER")).toBe("/dispatch");
  });

  it("maps every login slug back to its role and rejects unknown slugs", () => {
    for (const role of HUMAN_ROLES) expect(roleFromSlug(ROLE_PATHS[role].slug)).toBe(role);
    expect(roleFromSlug("admin")).toBeNull();
    expect(roleFromSlug(undefined)).toBeNull();
  });
});
