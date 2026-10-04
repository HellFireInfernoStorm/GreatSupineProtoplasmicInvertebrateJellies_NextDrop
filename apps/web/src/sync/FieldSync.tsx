import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isReauthNeeded, reauth, useReauthNeeded } from "../lib/session";
import { formatTime } from "../lib/time";
import { loginFailureOf, type LoginFailure } from "../login/useLogin";
import { syncController, useSyncActivity } from "./controller";
import { setForceOffline, useSyncDiagnostics } from "./hooks";
import { DEMO_MODE } from "../lib/demo";

/** Shared field plumbing; role screens remain under their own issue. */
export function FieldSync({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation("shared/common");
  const needed = useReauthNeeded();
  const activity = useSyncActivity();
  const diagnostics = useSyncDiagnostics();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<LoginFailure | null>(null);
  useEffect(() => {
    const stop = syncController.start();
    return stop;
  }, []);
  useEffect(() => {
    if (!needed) void syncController.syncNow();
  }, [needed]);
  return (
    <>
      <div hidden={compact}>
        <div
          role="status"
          className={`flex flex-wrap items-center gap-3 px-4 py-2 text-sm ${activity.offline || diagnostics.simulateOffline ? "bg-warn-bg text-warn-fg" : "bg-surface text-text"}`}
        >
          <span>
            {t(
              activity.offline || diagnostics.simulateOffline
                ? "sync.offline"
                : activity.syncing
                  ? "sync.syncing"
                  : needed
                    ? "sync.paused"
                    : activity.error
                      ? "sync.retrying"
                      : diagnostics.lastSyncedAt
                        ? "sync.synced"
                        : "sync.waiting",
            )}
          </span>
          <span>{t("sync.pending", { count: diagnostics.pendingCount })}</span>
          {diagnostics.lastSyncedAt && <span>{t("sync.last", { time: formatTime(diagnostics.lastSyncedAt) })}</span>}
          {!!diagnostics.failedItems.length && (
            <span>{t("sync.failed", { count: diagnostics.failedItems.length })}</span>
          )}
          {!!diagnostics.heldCount && <span>{t("sync.held", { count: diagnostics.heldCount })}</span>}
          <button type="button" disabled={needed || activity.syncing} onClick={() => void syncController.syncNow()}>
            {t("sync.now")}
          </button>
          {DEMO_MODE && diagnostics.ready && (
            <label>
              <input
                type="checkbox"
                checked={diagnostics.simulateOffline}
                onChange={(event) => void setForceOffline(event.target.checked)}
              />{" "}
              {t("sync.forceOffline")}
            </label>
          )}
        </div>
        {!!diagnostics.failedItems.length && (
          <details className="bg-surface p-4 text-text">
            <summary>{t("sync.details")}</summary>
            <ul>
              {diagnostics.failedItems.map((item) =>
                "clientEventId" in item && item.resolution ? (
                  <li key={item.clientEventId}>
                    {t("sync.rejectedAction", {
                      reference: item.subject.orderId ?? item.subject.tripId ?? item.clientEventId,
                      time: formatTime(item.resolution.resolvedAt),
                    })}
                    {item.resolution.note && <> {t("sync.dispatcherNote", { note: item.resolution.note })}</>}
                  </li>
                ) : (
                  <li key={"clientEventId" in item ? item.clientEventId : item.clientBlobId}>
                    {t("sync.failedAction", {
                      reference:
                        "clientEventId" in item
                          ? (item.subject.orderId ?? item.subject.tripId ?? item.clientEventId)
                          : item.clientBlobId,
                    })}{" "}
                    {t("sync.reason", { code: item.lastError ?? "UNKNOWN" })}
                  </li>
                ),
              )}
            </ul>
          </details>
        )}
        {!!diagnostics.heldItems.length && (
          <ul className="bg-warn-bg px-4 py-2 text-warn-fg">
            {diagnostics.heldItems.map((item) => (
              <li key={item.clientEventId}>
                {t("sync.heldAction", { reference: item.subject.orderId ?? item.subject.tripId ?? item.clientEventId })}{" "}
                {t("sync.captured", {
                  time: formatTime(new Date(Date.parse(item.capturedAt) + (item.clockOffsetMs ?? 0))),
                })}
                {item.confirmedAt && <span> · {t("sync.confirmed", { time: formatTime(item.confirmedAt) })}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {needed && (
        <form
          aria-label={t("sync.reauth")}
          className="border-b border-border bg-surface p-4 text-text"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !pin) return;
            setBusy(true);
            setFailure(null);
            void reauth(pin)
              .then(() => {
                setPin("");
                if (!isReauthNeeded()) void syncController.syncNow();
              })
              .catch((error) => setFailure(loginFailureOf(error)))
              .finally(() => setBusy(false));
          }}
        >
          <label className="flex flex-wrap items-center gap-3">
            {t("sync.reauth")}
            <input
              aria-label={t("sync.pin")}
              type="password"
              inputMode="numeric"
              pattern="[0-9]+"
              autoComplete="off"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
              className="min-h-11 rounded border border-border bg-surface-2 p-2"
            />
          </label>
          <p>{t("sync.kept")}</p>
          {failure && <p role="alert">{t(`sync.errors.${failure}`)}</p>}
          <button disabled={busy} type="submit" className="min-h-11 rounded bg-primary px-4 text-on-primary">
            {t("sync.unlock")}
          </button>
        </form>
      )}
    </>
  );
}
