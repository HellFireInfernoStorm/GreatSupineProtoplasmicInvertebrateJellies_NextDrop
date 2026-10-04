import { createBrowserRouter } from "react-router";
import { entryLoader, loginLoader, roleLoader } from "./loaders";
import { RouteError, Splash } from "./RouteError";

// Route groups from spec/frontend/architecture.md §14.1. Each role shell is a lazily loaded chunk and owns the
// routes below its group, so a role's screens are added in its own folder and not here.
export const router = createBrowserRouter([
  {
    ErrorBoundary: RouteError,
    HydrateFallback: Splash,
    children: [
      ...(import.meta.env.DEV
        ? [{ path: "/dev/ui", lazy: () => import("../ui/gallery/Gallery").then((m) => ({ Component: m.Gallery })) }]
        : []),
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
