import { useState } from "react";
import { useTranslation } from "react-i18next";
import { signOut, useSession } from "../../lib/session";
import { formatTime } from "../../lib/time";
import { LANGUAGE_LABELS, setFieldLanguage, useRoleLanguage } from "../../i18n/language";
import { LANGUAGES } from "../../i18n/resources";
import { DEMO_MODE } from "../../lib/demo";
import { setForceOffline, syncController, useSyncDiagnostics } from "../../sync";
import { useSyncActivity } from "../../sync/controller";
import { Banner, Button } from "../../ui";
import { useDriverData } from "./data";
import { capturedTime, savedDeliveryCount } from "./model";
import { Frame } from "./parts";
export function Settings() {
  const { t } = useTranslation("driver/run");
  const { user } = useSession();
  const { t: common } = useTranslation("shared/common");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const data = useDriverData();
  const diagnostics = useSyncDiagnostics();
  const activity = useSyncActivity();
  const lang = useRoleLanguage("DRIVER");
  return (
    <Frame back title={t("settings")} savedCount={savedDeliveryCount(data.receipts, data.events)}>
      <section className="driver-card">
        <h2>{user.displayName}</h2>
        <p>{t("language")}</p>
        <div className="driver-chips">
          {LANGUAGES.map((language) => (
            <Button
              key={language}
              variant={lang === language ? "primary" : "secondary"}
              aria-pressed={lang === language}
              onClick={() => setFieldLanguage(language)}
            >
              {LANGUAGE_LABELS[language]}
            </Button>
          ))}
        </div>
      </section>
      <section className="driver-card">
        <h2>{t("diagnostics")}</h2>
        <p>{t("waiting", { count: diagnostics.pendingCount })}</p>
        <p>{t("heldCount", { count: diagnostics.heldCount })}</p>
        <p>{t("failedCount", { count: diagnostics.failedItems.length })}</p>
        <p>
          {diagnostics.lastSyncedAt
            ? t("syncedAt", { time: formatTime(diagnostics.lastSyncedAt) })
            : t("waitingSignal")}
        </p>
        <Button
          variant="secondary"
          disabled={activity.syncing || activity.offline}
          onClick={() => void syncController.syncNow()}
        >
          {t("syncNow")}
        </Button>
        {DEMO_MODE && diagnostics.ready && (
          <label className="driver-toggle">
            <input
              type="checkbox"
              checked={diagnostics.simulateOffline}
              onChange={(e) => void setForceOffline(e.target.checked)}
            />
            {t("forceOffline")}
          </label>
        )}
      </section>
      {[...diagnostics.heldItems, ...diagnostics.failedItems].map((item) => (
        <section className="driver-card" key={"clientEventId" in item ? item.clientEventId : item.clientBlobId}>
          <h2>
            {t("clientEventId" in item ? `event.${item.type}` : "photoQueued", {
              defaultValue: "clientEventId" in item ? item.type : t("photoQueued"),
            })}
          </h2>
          {"clientEventId" in item && (
            <>
              <p>{item.subject.orderId ?? item.subject.tripId}</p>
              <p>{t("captured", { time: formatTime(capturedTime(item)) })}</p>
              {item.confirmedAt && <p>{t("received", { time: formatTime(item.confirmedAt) })}</p>}
              {item.resolution && (
                <Banner
                  tone="warn"
                  message={t(`decision.${item.resolution.decision}`)}
                  detail={item.resolution.note ?? t("reasonUnavailable")}
                />
              )}
            </>
          )}
          {item.lastError && <p>{t(`error.${item.lastError}`, { defaultValue: t("needsAttention") })}</p>}
        </section>
      ))}
      {signOutError && <Banner tone="warn" message={common("session.signOutFailed")} />}
      <Button
        variant="secondary"
        loading={signingOut}
        disabled={activity.offline}
        onClick={() => {
          setSigningOut(true);
          setSignOutError(false);
          void signOut()
            .catch(() => setSignOutError(true))
            .finally(() => setSigningOut(false));
        }}
      >
        {common("session.signOut")}
      </Button>
    </Frame>
  );
}
