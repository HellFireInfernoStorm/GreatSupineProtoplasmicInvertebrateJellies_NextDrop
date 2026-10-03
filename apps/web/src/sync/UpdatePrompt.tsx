import { useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useTranslation } from "react-i18next";
import { useSyncActivity } from "./controller";

/** Reload only after the person confirms an idle moment, and never during an active sync. */
export function UpdatePrompt() {
  const {
    needRefresh: [ready],
    updateServiceWorker,
  } = useRegisterSW();
  const { t } = useTranslation("shared/common");
  const [safe, setSafe] = useState(false);
  const syncing = useSyncActivity((s) => s.syncing);
  if (!ready) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 right-4 z-50 rounded border border-border bg-surface p-4 text-text shadow-lg"
    >
      <p>{t("sync.update")}</p>
      <label>
        <input type="checkbox" checked={safe} onChange={(event) => setSafe(event.target.checked)} /> {t("sync.safe")}
      </label>
      <button
        type="button"
        disabled={!safe || syncing}
        onClick={() => void updateServiceWorker(true)}
        className="ml-3 rounded bg-primary px-4 py-2 text-on-primary"
      >
        {t("sync.apply")}
      </button>
    </div>
  );
}
