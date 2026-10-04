import { Navigate, Route, Routes } from "react-router";
import { RoleShell } from "../../app/RoleShell";
import { ROLE_PATHS } from "../../app/roles";
import { Run } from "./Run";
import { StopPage } from "./Stop";
import { SyncPage } from "./Sync";
import { Settings } from "./Settings";
import "./driver.css";

/** Offline-first Driver run, delivery and recovery screens. */
export function DriverShell() {
  return (
    <RoleShell role="DRIVER">
      <Routes>
        <Route index element={<Run />} />
        <Route path="stop/:stopId" element={<StopPage />} />
        <Route path="sync" element={<SyncPage />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to={ROLE_PATHS.DRIVER.home} replace />} />
      </Routes>
    </RoleShell>
  );
}
