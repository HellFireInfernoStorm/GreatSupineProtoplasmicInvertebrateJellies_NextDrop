import { createBrowserRouter, Navigate } from "react-router";

// Route groups from spec/frontend/architecture.md. Each role shell is a lazily loaded chunk.
// Guards (GET /auth/me) and the screens arrive with the web shell (#36) and the role issues.
export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/login" replace /> },
  { path: "/login", lazy: () => import("../login/LoginRoute").then((m) => ({ Component: m.LoginRoute })) },
  { path: "/store/*", lazy: () => import("../roles/store").then((m) => ({ Component: m.StoreShell })) },
  { path: "/dispatch/*", lazy: () => import("../roles/dispatcher").then((m) => ({ Component: m.DispatcherShell })) },
  { path: "/loader/*", lazy: () => import("../roles/loader").then((m) => ({ Component: m.LoaderShell })) },
  { path: "/driver/*", lazy: () => import("../roles/driver").then((m) => ({ Component: m.DriverShell })) },
  { path: "*", element: <Navigate to="/login" replace /> },
]);
