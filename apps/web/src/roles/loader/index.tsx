import { useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useTranslation } from "react-i18next";
import { RoleShell } from "../../app/RoleShell";
import { ROLE_PATHS } from "../../app/roles";
import { useServerNow, clockOffsetMs } from "../../lib/clock";
import { useSession } from "../../lib/session";
import { fieldRepository } from "../../sync";
import { Button, Toast } from "../../ui";
import { useLoaderData } from "./data";
import { undoDraft } from "./drafts";
import { Dock } from "./Dock";
import { Checklist } from "./Checklist";
import { Ready } from "./Ready";
import { Connection } from "./Connection";
import "./loader.css";
function Workspace() {
  const data = useLoaderData();
  const deviceNow = useServerNow(250).getTime() - clockOffsetMs();
  const { user } = useSession();
  const { t } = useTranslation("loader/dock");
  const [dismissed, setDismissed] = useState<string>();
  const draft = data.drafts.filter((d) => d.key !== dismissed).at(-1);
  return (
    <>
      <Routes>
        <Route index element={<Dock data={data} />} />
        <Route path="trips/:tripId" element={<Checklist data={data} />} />
        <Route path="trips/:tripId/ready" element={<Ready data={data} />} />
        <Route path="connection" element={<Connection data={data} />} />
        <Route path="*" element={<Navigate to={ROLE_PATHS.LOADER.home} replace />} />
      </Routes>
      <Toast
        open={!!draft}
        notificationId={draft?.key}
        onClose={() => setDismissed(draft?.key)}
        message={t("draftSaved")}
        durationMs={draft ? Math.max(1, draft.expiresAt - deviceNow) : 5000}
        action={
          draft && (
            <Button variant="secondary" onClick={() => void undoDraft(fieldRepository, draft.key, user.id)}>
              {t("undo")}
            </Button>
          )
        }
      />
    </>
  );
}
export function LoaderShell() {
  return (
    <RoleShell role="LOADER">
      <Workspace />
    </RoleShell>
  );
}
