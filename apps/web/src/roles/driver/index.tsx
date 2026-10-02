import { Outlet } from "react-router";

/** Driver role shell. Screens are added as nested routes. */
export function DriverShell() {
  return (
    <main data-theme="driver" className="min-h-dvh">
      <Outlet />
    </main>
  );
}
