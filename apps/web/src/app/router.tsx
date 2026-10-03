import type { HumanRole } from "@nextdrop/contracts";
import { createBrowserRouter, redirect, type LoaderFunctionArgs } from "react-router";
import { queryClient } from "../lib/queryClient";
import { sessionQuery } from "../lib/session";
import { guardLogin, guardRole, lastLoginRole, roleFromSlug, ROLE_PATHS } from "./roles";
import { RouteError, Splash } from "./RouteError";

// Route groups from spec/frontend/architecture.md §14.1. Each role shell is a lazily loaded chunk and owns the
// routes below its group, so a role's screens are added in its own folder and not here.

/** The signed-in role from GET /auth/me, or null. A network failure rejects and shows the route error screen. */
async function sessionRole(): Promise<HumanRole | null> {
  const session = await queryClient.fetchQuery(sessionQuery);
  return session?.user.role ?? null;
}

/** `/`, `/login` and unknown paths: the signed-in role's home, or the login screen this device used last. */
async function entryLoader() {
  const role = await sessionRole();
  return redirect(role ? ROLE_PATHS[role].home : ROLE_PATHS[lastLoginRole()].login);
}

async function loginLoader({ params }: LoaderFunctionArgs) {
  const signedIn = guardLogin(await sessionRole());
  if (signedIn) return redirect(signedIn);
  if (!roleFromSlug(params.role)) return redirect(ROLE_PATHS[lastLoginRole()].login);
  return null;
}

function roleLoader(role: HumanRole) {
  return async () => {
    const target = guardRole(await sessionRole(), role);
    return target ? redirect(target) : null;
  };
}

export const router = createBrowserRouter([
  {
    ErrorBoundary: RouteError,
    HydrateFallback: Splash,
    children: [
      { path: "/", loader: entryLoader },
      { path: "/login", loader: entryLoader },
      {
        path: "/login/:role",
        loader: loginLoader,
        lazy: () => import("../login/LoginRoute").then((m) => ({ Component: m.LoginRoute })),
      },
      {
        path: "/store/*",
        loader: roleLoader("STORE"),
        lazy: () => import("../roles/store").then((m) => ({ Component: m.StoreShell })),
      },
      {
        path: "/dispatch/*",
        loader: roleLoader("DISPATCHER"),
        lazy: () => import("../roles/dispatcher").then((m) => ({ Component: m.DispatcherShell })),
      },
      {
        path: "/loader/*",
        loader: roleLoader("LOADER"),
        lazy: () => import("../roles/loader").then((m) => ({ Component: m.LoaderShell })),
      },
      {
        path: "/driver/*",
        loader: roleLoader("DRIVER"),
        lazy: () => import("../roles/driver").then((m) => ({ Component: m.DriverShell })),
      },
      { path: "*", loader: entryLoader },
    ],
  },
]);
