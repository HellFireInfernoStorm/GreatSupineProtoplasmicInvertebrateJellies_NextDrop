import { Navigate, Route, Routes } from "react-router";
import { RoleShell } from "../../app/RoleShell";
import { ROLE_PATHS } from "../../app/roles";
import { ShellHome } from "../../app/ShellHome";

/** Dispatcher role shell. Add the role's screens as routes here; ShellHome is the stand-in first screen. */
export function DispatcherShell() {
  return (
    <RoleShell role="DISPATCHER">
      <Routes>
        <Route index element={<ShellHome />} />
        <Route path="*" element={<Navigate to={ROLE_PATHS.DISPATCHER.home} replace />} />
      </Routes>
    </RoleShell>
  );
}
