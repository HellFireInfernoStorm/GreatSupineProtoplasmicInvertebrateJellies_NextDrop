// The seeded accounts of spec/data/seed-and-demo.md §15.3, as the README lists them. Demo values, not secrets.
// They repeat `apps/api/prisma/seed/accounts.ts`: e2e drives the app from outside and imports neither app.

export type Role = "STORE" | "DISPATCHER" | "LOADER" | "DRIVER";

export const DEMO_PASSWORD = "nextdrop-demo";
export const DEMO_PIN = "2468";

export interface Account {
  role: Role;
  /** The last segment of the login path and the role's route group. */
  loginPath: string;
  home: string;
  /** What the person types on the login screen, and what the quick-login chip shows. */
  login: string;
  /** The name the shell greets them with. */
  name: string;
  /**
   * A fixed identity for this person's device, as one real phone has. The server takes a vehicle's "last heard"
   * from the driver's devices, so every sign-in as the walkthrough driver must come from the same phone.
   */
  deviceId?: string;
}

export const ACCOUNTS = {
  /** Dilini, the peak-day store: steps 1 and 6. */
  store: { role: "STORE", loginPath: "/login/store", home: "/store", login: "OUT004", name: "Dilini" },
  /** Ishara, the hill store on Sampath's trip: step 13. */
  hillStore: { role: "STORE", loginPath: "/login/store", home: "/store", login: "OUT104", name: "Ishara" },
  dispatcher: {
    role: "DISPATCHER",
    loginPath: "/login/dispatch",
    home: "/dispatch",
    login: "nimal@waypoint.test",
    name: "Nimal",
  },
  /** Kasun, Peliyagoda dock. */
  loader: { role: "LOADER", loginPath: "/login/loader", home: "/loader", login: "LDR001", name: "Kasun" },
  /** Pradeep, Kandy dock: loads Sampath's truck in step 7. */
  kandyLoader: { role: "LOADER", loginPath: "/login/loader", home: "/loader", login: "LDR002", name: "Pradeep" },
  /** Sampath on VEH039, the walkthrough driver: steps 8, 9 and 11. */
  driver: {
    role: "DRIVER",
    loginPath: "/login/driver",
    home: "/driver",
    login: "DRV039",
    name: "Sampath",
    deviceId: "01920000-0000-7000-8000-000000000039",
  },
} as const satisfies Record<string, Account>;

export const DEPOTS = { peliyagoda: "Peliyagoda", kandy: "Kandy" } as const;
