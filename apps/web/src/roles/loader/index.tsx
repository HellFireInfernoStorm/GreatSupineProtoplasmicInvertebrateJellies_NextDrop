import { Navigate, Route, Routes } from "react-router";
import { RoleShell } from "../../app/RoleShell";
import { ROLE_PATHS } from "../../app/roles";
import { ShellHome } from "../../app/ShellHome";

/** Loader role shell. Add the role's screens as routes here; ShellHome is the stand-in first screen. */
export function LoaderShell() {
  return (
    <RoleShell role="LOADER">
      <Routes>
        <Route index element={<ShellHome />} />
        <Route path="*" element={<Navigate to={ROLE_PATHS.LOADER.home} replace />} />
      </Routes>
    </RoleShell>
  );
}
