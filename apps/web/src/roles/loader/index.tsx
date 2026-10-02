import { Outlet } from "react-router";

/** Loader role shell. Screens are added as nested routes. */
export function LoaderShell() {
  return (
    <main data-theme="loader" className="min-h-dvh">
      <Outlet />
    </main>
  );
}
