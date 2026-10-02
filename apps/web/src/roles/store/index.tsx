import { Outlet } from "react-router";

/** Store role shell. Screens are added as nested routes. */
export function StoreShell() {
  return (
    <main data-theme="store" className="min-h-dvh">
      <Outlet />
    </main>
  );
}
