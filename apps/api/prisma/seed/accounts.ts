// Seeded accounts (seed-and-demo.md §15.3) and a Driver record for every vehicle.
// Demo credentials are documented in the README; they are demo values, not secrets.
import { hash, verify } from "argon2";
import type { PrismaClient } from "../../src/generated/prisma/client";
import type { Role } from "../../src/generated/prisma/enums";
import { driverIdFor } from "./pick-fixtures";
import type { ReferenceIds } from "./reference";
import {
  HILL_STORE_OUTLET_ID,
  KANDY_LOADER_LOGIN_ID,
  PEAK_STORE_OUTLET_ID,
  WALKTHROUGH_DRIVER_ID,
  WALKTHROUGH_VEHICLE_ID,
} from "./story-fixtures";
import { changedFields, type SyncResult } from "./sync";

/** Store manager and dispatcher password. */
export const DEMO_PASSWORD = "nextdrop-demo";
/** Loader and driver PIN. */
export const DEMO_PIN = "2468";

export interface AccountSpec {
  readonly loginId: string;
  readonly role: Role;
  readonly displayName: string;
  /** Null for a dispatcher means every depot. */
  readonly depot: string | null;
  readonly outlet?: string;
  readonly vehicle?: string;
  readonly secret: string;
}

export const DISPATCHER_LOGIN_ID = "nimal@waypoint.test";

export const ACCOUNTS: readonly AccountSpec[] = [
  // One account per role for judges.
  {
    loginId: PEAK_STORE_OUTLET_ID,
    role: "STORE",
    displayName: "Dilini",
    depot: "Peliyagoda",
    outlet: PEAK_STORE_OUTLET_ID,
    secret: DEMO_PASSWORD,
  },
  { loginId: DISPATCHER_LOGIN_ID, role: "DISPATCHER", displayName: "Nimal", depot: null, secret: DEMO_PASSWORD },
  { loginId: "LDR001", role: "LOADER", displayName: "Kasun", depot: "Peliyagoda", secret: DEMO_PIN },
  {
    loginId: WALKTHROUGH_DRIVER_ID,
    role: "DRIVER",
    displayName: "Sampath",
    depot: "Kandy",
    vehicle: WALKTHROUGH_VEHICLE_ID,
    secret: DEMO_PIN,
  },
  // Extras for the Kandy and multi-outlet scenarios.
  {
    loginId: "DRV001",
    role: "DRIVER",
    displayName: "Ruwan S.",
    depot: "Peliyagoda",
    vehicle: "VEH001",
    secret: DEMO_PIN,
  },
  { loginId: KANDY_LOADER_LOGIN_ID, role: "LOADER", displayName: "Pradeep", depot: "Kandy", secret: DEMO_PIN },
  {
    loginId: HILL_STORE_OUTLET_ID,
    role: "STORE",
    displayName: "Ishara",
    depot: "Kandy",
    outlet: HILL_STORE_OUTLET_ID,
    secret: DEMO_PASSWORD,
  },
];

/** Driver names by vehicle: the two story drivers, then a fixed list for the rest of the fleet. */
const DRIVER_NAMES = [
  "Ajith P.",
  "Bandula K.",
  "Chaminda R.",
  "Dhanushka W.",
  "Eranga M.",
  "Gayan T.",
  "Harsha L.",
  "Indika S.",
  "Janaka D.",
  "Kamal F.",
  "Lahiru N.",
  "Mahesh J.",
  "Nalin A.",
  "Prasanna G.",
  "Roshan H.",
  "Saman B.",
  "Tharindu C.",
  "Upul E.",
  "Viraj O.",
  "Wasantha I.",
];

export function driverNameFor(vehicleId: string): string {
  if (vehicleId === WALKTHROUGH_VEHICLE_ID) return "Sampath";
  if (vehicleId === "VEH001") return "Ruwan S.";
  const n = Number(vehicleId.replace(/^VEH/, ""));
  return DRIVER_NAMES[(n - 1) % DRIVER_NAMES.length] as string;
}

/** A clearly synthetic phone number. */
export function driverPhoneFor(vehicleId: string): string {
  return `+94 000 000 ${vehicleId.replace(/^VEH/, "")}`;
}

/** Argon2 salts every hash, so a stored hash is kept while it still verifies the demo secret. */
async function hashFor(stored: string | undefined, secret: string): Promise<string> {
  if (stored && (await verify(stored, secret).catch(() => false))) return stored;
  return hash(secret);
}

export async function seedAccounts(
  db: PrismaClient,
  ids: ReferenceIds,
): Promise<{ userIds: ReadonlyMap<string, string>; result: SyncResult }> {
  const result: SyncResult = { created: 0, updated: 0 };

  // Drivers first: one per vehicle, display ID following the vehicle number.
  const drivers = new Map((await db.driver.findMany()).map((d) => [d.displayId, d]));
  for (const [vehicleDisplayId, vehicleId] of [...ids.vehicles].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const displayId = driverIdFor(vehicleDisplayId);
    const wanted = {
      displayId,
      name: driverNameFor(vehicleDisplayId),
      phone: driverPhoneFor(vehicleDisplayId),
      vehicleId,
    };
    const current = drivers.get(displayId);
    if (!current) {
      await db.driver.create({ data: wanted });
      result.created++;
    } else {
      const changes = changedFields(current, wanted);
      if (changes) {
        await db.driver.update({ where: { id: current.id }, data: changes });
        result.updated++;
      }
    }
  }

  const users = new Map((await db.user.findMany()).map((u) => [u.loginId, u]));
  for (const account of ACCOUNTS) {
    const current = users.get(account.loginId);
    const wanted = {
      loginId: account.loginId,
      role: account.role,
      displayName: account.displayName,
      passwordHash: await hashFor(current?.passwordHash, account.secret),
      depot: account.depot,
      outletId: account.outlet ? lookup(ids.outlets, account.outlet) : null,
      vehicleId: account.vehicle ? lookup(ids.vehicles, account.vehicle) : null,
    };
    if (!current) {
      await db.user.create({ data: wanted });
      result.created++;
    } else {
      const changes = changedFields(current, wanted);
      if (changes) {
        await db.user.update({ where: { id: current.id }, data: changes });
        result.updated++;
      }
    }
  }

  const userIds = new Map(
    (await db.user.findMany({ where: { loginId: { in: ACCOUNTS.map((a) => a.loginId) } } })).map((u) => [
      u.loginId,
      u.id,
    ]),
  );
  return { userIds, result };
}

export function lookup(map: ReadonlyMap<string, string>, key: string): string {
  const id = map.get(key);
  if (!id) throw new RangeError(`not seeded: ${key}`);
  return id;
}
