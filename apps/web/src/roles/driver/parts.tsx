import { mapsUrl, type Stop } from "./model";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useServerNow } from "../../lib/clock";
import { formatTime } from "../../lib/time";
import { useSyncActivity } from "../../sync/controller";
import { useSyncDiagnostics } from "../../sync";
import { Button, Banner } from "../../ui";
const assets = import.meta.glob<string>("./assets/*.svg", { eager: true, query: "?url", import: "default" });
const glyphs = {
  saved: "74dd1",
  dot: "cf318",
  chilled: "83d19",
  check: "933b0",
  double: "509f1",
  clock: "7eb83",
  dock: "23136",
  info: "1e4d7",
  route: "ac002",
  next: "e8877",
  back: "b5ae1",
  flag: "2c339",
  full: "b02b6",
  partial: "8aefe",
  refused: "55389",
  photo: "edc5f",
  undo: "b6625",
  send: "d59fe",
  sync: "e8f3a",
  outlet: "89628",
};
export function Icon({ name }: { name: keyof typeof glyphs }) {
  return <img className="driver-icon" src={assets[`./assets/${glyphs[name]}.svg`]} alt="" aria-hidden="true" />;
}
export function SyncBadge() {
  const { t } = useTranslation("driver/run");
  const { pendingCount, confirmationCount, heldCount, failedItems, lastSyncedAt } = useSyncDiagnostics();
  const activity = useSyncActivity();
  const text = activity.offline
    ? t("offline")
    : activity.syncing
      ? pendingCount
        ? t("syncing", { count: pendingCount })
        : t("reconnecting")
      : heldCount
        ? t("needsDispatch")
        : failedItems.length || activity.error
          ? t("needsAttention")
          : pendingCount
            ? t("waiting", { count: pendingCount })
            : confirmationCount
              ? t("waitingSnapshot")
              : lastSyncedAt
                ? t("syncedAt", { time: formatTime(lastSyncedAt) })
                : t("waitingSignal");
  return (
    <Link
      to="/driver/sync"
      className="driver-sync"
      data-tone={
        activity.offline
          ? "warn"
          : activity.syncing
            ? "info"
            : heldCount || failedItems.length || activity.error
              ? "warn"
              : "ok"
      }
    >
      {!activity.offline && !activity.syncing && !heldCount && !failedItems.length && !activity.error ? (
        <Icon name="dot" />
      ) : (
        <span className="driver-dot" />
      )}
      {text}
    </Link>
  );
}
export function Frame({
  title,
  back = false,
  children,
  footer,
  savedCount = 0,
}: {
  title: string;
  back?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  savedCount?: number;
}) {
  const { t } = useTranslation("driver/run");
  const now = useServerNow(30000);
  const offline = useSyncActivity((s) => s.offline);
  return (
    <div className="driver-frame">
      <div className="driver-status">
        <time dateTime={now.toISOString()}>{formatTime(now)}</time>
        <Link to="/driver/settings">{t("settings")}</Link>
      </div>
      <header className="driver-header">
        {back && (
          <Link aria-label={t("back")} to="/driver">
            <Icon name="back" />
          </Link>
        )}
        <h1>{title}</h1>
        <SyncBadge />
      </header>
      {offline && <Banner tone="warn" message={t("offlineSaved", { count: savedCount })} />}
      <main className="driver-main">{children}</main>
      {footer && <footer className="driver-footer">{footer}</footer>}
    </div>
  );
}
export function Action({
  children,
  onClick,
  disabled = false,
  loading = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Button size="lg" className="driver-action" onClick={onClick} disabled={disabled} loading={loading}>
      {children}
    </Button>
  );
}
export function Maps({ stop }: { stop: Stop }) {
  const { t } = useTranslation("driver/run");
  return (
    <a
      className="driver-maps"
      href={mapsUrl(stop.outlet.address, stop.outlet.name, stop.outlet.district)}
      target="_blank"
      rel="noreferrer"
    >
      <Icon name="route" />
      {t("maps")}
    </a>
  );
}
