import type { HumanRole, LoginRequest } from "@nextdrop/contracts";

// The seeded demo accounts behind the quick-login chips (spec/data/seed-and-demo.md §15.2, §15.3).
//
// PLACEHOLDERS: these mirror the contract login fixtures. The real IDs and demo credentials come from the story
// fixtures (#24) and the seed (#30); replace them here when those land. A test keeps this file equal to the
// fixtures until then.

export interface DemoAccount {
  role: HumanRole;
  /** What the chip shows after the role name. */
  login: string;
  request: (deviceId: string) => LoginRequest;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    role: "STORE",
    login: "OUT015",
    request: () => ({ role: "STORE", loginId: "OUT015", password: "mock-password" }),
  },
  {
    role: "DISPATCHER",
    login: "Peliyagoda",
    request: () => ({
      role: "DISPATCHER",
      email: "dispatcher@example.com",
      password: "mock-password",
      depot: "Peliyagoda",
    }),
  },
  {
    role: "LOADER",
    login: "LDR001",
    request: (deviceId) => ({ role: "LOADER", loginId: "LDR001", pin: "1234", deviceId }),
  },
  {
    role: "DRIVER",
    login: "DRV001",
    request: (deviceId) => ({ role: "DRIVER", loginId: "DRV001", pin: "1234", deviceId }),
  },
];
