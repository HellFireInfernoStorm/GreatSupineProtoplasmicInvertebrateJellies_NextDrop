import { HUMAN_ROLES, type HumanRole } from "@nextdrop/contracts";
import { readStored, writeStored } from "../lib/storage";

// Where each role lives (spec/frontend/architecture.md §14.1) and the pure decisions the route guards make.

export interface RolePaths {
  /** The role's route group and first screen. */
  home: string;
  /** The role's login screen. */
  login: string;
  /** The last segment of the login path. */
  slug: string;
  theme: "store" | "dispatcher" | "loader" | "driver";
}

export const ROLE_PATHS: Record<HumanRole, RolePaths> = {
  STORE: { home: "/store", login: "/login/store", slug: "store", theme: "store" },
  DISPATCHER: { home: "/dispatch", login: "/login/dispatch", slug: "dispatch", theme: "dispatcher" },
  LOADER: { home: "/loader", login: "/login/loader", slug: "loader", theme: "loader" },
  DRIVER: { home: "/driver", login: "/login/driver", slug: "driver", theme: "driver" },
};

export function roleFromSlug(slug: string | undefined): HumanRole | null {
  return HUMAN_ROLES.find((role) => ROLE_PATHS[role].slug === slug) ?? null;
}

/** Where to send someone who opens a role's routes: null lets them in. */
export function guardRole(sessionRole: HumanRole | null, routeRole: HumanRole): string | null {
  if (sessionRole === null) return ROLE_PATHS[routeRole].login;
  if (sessionRole !== routeRole) return ROLE_PATHS[sessionRole].home;
  return null;
}

/** Where to send someone who opens a login screen: null shows it. */
export function guardLogin(sessionRole: HumanRole | null): string | null {
  return sessionRole === null ? null : ROLE_PATHS[sessionRole].home;
}

const LAST_ROLE_KEY = "nextdrop.lastRole";

/** The login screen this device used last, so `/login` opens the right one on a shared tablet or a phone. */
export function lastLoginRole(): HumanRole {
  const stored = readStored(LAST_ROLE_KEY);
  return HUMAN_ROLES.find((role) => role === stored) ?? "STORE";
}

export function rememberLoginRole(role: HumanRole): void {
  writeStored(LAST_ROLE_KEY, role);
}
