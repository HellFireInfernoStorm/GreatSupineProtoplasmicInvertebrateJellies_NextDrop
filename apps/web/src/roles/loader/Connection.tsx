import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Frame, Back, Button } from "./parts";
import type { LoaderData } from "./data";
import { syncController, setForceOffline, useSyncDiagnostics } from "../../sync";
import { useSyncActivity } from "../../sync/controller";
import { signOut } from "../../lib/session";
import { formatTime } from "../../lib/time";
import { Banner } from "../../ui";
import { DEMO_MODE } from "../../lib/demo";
export function Connection({ data }: { data: LoaderData }) {
  const { t } = useTranslation("loader/dock");
  const diagnostics = useSyncDiagnostics();
  const { t: common } = useTranslation("shared/common");
  const activity = useSyncActivity();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Frame data={data}>
      <Back to="/loader" label={t("trips")} />
      <h1>{t("connection")}</h1>
      <p>{t("switchUserNote")}</p>
      <p>{common("sync.pending", { count: diagnostics.pendingCount + data.drafts.length })}</p>
      {diagnostics.lastSyncedAt && <p>{common("sync.last", { time: formatTime(diagnostics.lastSyncedAt) })}</p>}
      {diagnostics.confirmationCount > 0 && <Banner tone="info" message={t("awaitingSnapshot")} />}
      {activity.error && <Banner tone="warn" message={common("sync.retrying")} />}
      {[...diagnostics.heldItems, ...diagnostics.failedItems].map((item) => (
        <section className="loader-card" key={"clientEventId" in item ? item.clientEventId : item.clientBlobId}>
          <p>{t("state" in item && item.state === "held" ? "held" : "failed")}</p>
          <p>
            {common("sync.failedAction", {
              reference:
                "clientEventId" in item
                  ? (item.subject.orderId ?? item.subject.tripId ?? item.clientEventId)
                  : item.clientBlobId,
            })}
          </p>
          {item.lastError && <p>{common("sync.reason", { code: item.lastError })}</p>}
          {"clientEventId" in item && item.resolution?.note && <p>{item.resolution.note}</p>}
        </section>
      ))}
      <Button
        variant="secondary"
        disabled={activity.offline || activity.syncing}
        onClick={() => void syncController.syncNow()}
      >
        {t("syncNow")}
      </Button>
      {DEMO_MODE && (
        <label className="loader-photo">
          <input
            type="checkbox"
            checked={diagnostics.simulateOffline}
            onChange={(e) => void setForceOffline(e.target.checked)}
          />
          {t("forceOffline")}
        </label>
      )}
      {error && <Banner tone="warn" message={t("signOutError")} />}
      <Button
        variant="secondary"
        loading={busy}
        onClick={() => {
          setBusy(true);
          setError(false);
          void signOut()
            .catch(() => setError(true))
            .finally(() => setBusy(false));
        }}
      >
        {t("switchUser")}
      </Button>
    </Frame>
  );
}
