import { randomBytes } from "node:crypto";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface LockoutConfig {
  /** Failures allowed before the first lock. */
  threshold: number;
  /** First lock duration; doubles with each further failure. */
  baseMs: number;
  maxMs: number;
}

export interface AuthConfig {
  sessionSecret: string;
  /** Sliding lifetimes (spec/assumptions.md: web 12 h, field 14 d). */
  webTtlMs: number;
  fieldTtlMs: number;
  /** ADR 0024: FIELD rows can be renewed by PIN until expiresAt + this many days. */
  fieldReauthGraceDays: number;
  secureCookie: boolean;
  demoMode: boolean;
  /** Empty disables the script-key path. */
  demoScriptKey: string;
  lockout: LockoutConfig;
  /** Per-IP transport limit on login and reauth, before credential lockout. */
  loginRateLimit: { max: number; timeWindowMs: number };
}

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function authConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const production = env.NODE_ENV === "production";
  const secret = env.SESSION_SECRET ?? "";
  if (production && secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters in production");
  return {
    // Outside production a missing secret means sessions do not survive a restart.
    sessionSecret: secret || randomBytes(32).toString("hex"),
    webTtlMs: 12 * HOUR_MS,
    fieldTtlMs: 14 * DAY_MS,
    fieldReauthGraceDays: positiveInt(env.FIELD_REAUTH_GRACE_DAYS, 30, "FIELD_REAUTH_GRACE_DAYS"),
    secureCookie: production || (env.PUBLIC_ORIGIN ?? "").startsWith("https://"),
    demoMode: env.DEMO_MODE === "true",
    demoScriptKey: env.DEMO_SCRIPT_KEY ?? "",
    lockout: { threshold: 5, baseMs: 30_000, maxMs: 15 * 60_000 },
    loginRateLimit: { max: 30, timeWindowMs: 60_000 },
  };
}

export const DAY = DAY_MS;
