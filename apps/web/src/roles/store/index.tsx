import { Navigate, Route, Routes } from "react-router";
import { RoleShell } from "../../app/RoleShell";
import { ROLE_PATHS } from "../../app/roles";
import { ShellHome } from "../../app/ShellHome";

/** Store role shell. Add the role's screens as routes here; ShellHome is the stand-in first screen. */
export function StoreShell() {
  return (
    <RoleShell role="STORE">
      <Routes>
        <Route index element={<ShellHome />} />
        <Route path="*" element={<Navigate to={ROLE_PATHS.STORE.home} replace />} />
      </Routes>
    </RoleShell>
  );
}
