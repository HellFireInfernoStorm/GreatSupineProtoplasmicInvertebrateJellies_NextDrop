import type { HumanRole, LoginRequest } from "@nextdrop/contracts";

// The seeded demo accounts behind the quick-login chips, one per role (spec/data/seed-and-demo.md §15.2, §15.3).
//
// These repeat the judge accounts and demo credentials of the seed, `apps/api/prisma/seed/accounts.ts`, because
// the web app may not import from the API. They are demo values, not secrets. Change both files together.

const DEMO_PASSWORD = "nextdrop-demo";
const DEMO_PIN = "2468";

export interface DemoAccount {
  role: HumanRole;
  /** What the chip shows after the role name. */
  login: string;
  request: (deviceId: string) => LoginRequest;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    role: "STORE",
    login: "OUT004",
    request: () => ({ role: "STORE", loginId: "OUT004", password: DEMO_PASSWORD }),
  },
  {
    role: "DISPATCHER",
    login: "Peliyagoda",
    request: () => ({
      role: "DISPATCHER",
      email: "nimal@waypoint.test",
      password: DEMO_PASSWORD,
      depot: "Peliyagoda",
    }),
  },
  {
    role: "LOADER",
    login: "LDR001",
    request: (deviceId) => ({ role: "LOADER", loginId: "LDR001", pin: DEMO_PIN, deviceId }),
  },
  {
    role: "DRIVER",
    login: "DRV039",
    request: (deviceId) => ({ role: "DRIVER", loginId: "DRV039", pin: DEMO_PIN, deviceId }),
  },
];
