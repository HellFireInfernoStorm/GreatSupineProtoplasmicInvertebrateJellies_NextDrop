import { Outlet } from "react-router";

/** Dispatcher role shell. Screens are added as nested routes. */
export function DispatcherShell() {
  return (
    <main data-theme="dispatcher" className="min-h-dvh">
      <Outlet />
    </main>
  );
}
