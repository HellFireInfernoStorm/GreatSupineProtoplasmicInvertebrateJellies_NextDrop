import type { HumanRole } from "@nextdrop/contracts";

/** The roles that work offline, sign in with a PIN and ship en, si and ta: Loader and Driver. */
export type FieldRole = Extract<HumanRole, "LOADER" | "DRIVER">;

export function isFieldRole(role: HumanRole): role is FieldRole {
  return role === "LOADER" || role === "DRIVER";
}
