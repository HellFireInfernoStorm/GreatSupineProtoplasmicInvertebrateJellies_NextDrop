import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useServerNow } from "../../lib/clock";
import { formatTime } from "../../lib/time";
import { useSession } from "../../lib/session";
import { LanguageChips } from "../../login/pin";
import { useRoleLanguage } from "../../i18n/language";
import { Button, Banner, CapacityBar } from "../../ui";
import { Pill } from "../../ui/StatusPill";
import { useSyncDiagnostics } from "../../sync";
import { useReauthNeeded } from "../../lib/session";
import { useSyncActivity } from "../../sync/controller";
import type { LoaderData } from "./data";
import type { TripDto } from "@nextdrop/contracts";
import { loadTotals } from "./model";
import type { FieldReceipt } from "../../sync/database";
const assets = import.meta.glob<string>("./assets/*.svg", { eager: true, query: "?url", import: "default" });
const glyphs = {
  dock: "fb73d",
  clock: "06d92",
  reefer: "a9109",
  check: "932ce",
  flag: "19b05",
  damaged: "74c23",
  photo: "68059",
  arrow: "1994c",
  undo: "4ed7a",
  send: "8c2fe",
  sync: "e669a",
};
export function Icon({ name }: { name: keyof typeof glyphs }) {
  return <img src={assets[`./assets/${glyphs[name]}.svg`]} alt="" aria-hidden="true" />;
}
export function Countdown({ departure }: { departure: string }) {
  const { t } = useTranslation("loader/dock");
  const now = useServerNow(30000);
  const minutes = Math.ceil((Date.parse(departure) - now.getTime()) / 60000);
  return (
    <span className="loader-muted">
      <Icon name="clock" />
      {t(minutes >= 0 ? "departsIn" : "overdue", { minutes: Math.abs(minutes) })}
    </span>
  );
}
export function Frame({ data, children, footer }: { data: LoaderData; children: ReactNode; footer?: ReactNode }) {
  const { t } = useTranslation("loader/dock");
  const { user } = useSession();
  const language = useRoleLanguage("LOADER");
  const { t: common } = useTranslation("shared/common");
  const diagnostics = useSyncDiagnostics();
  const activity = useSyncActivity();
  const reauth = useReauthNeeded();
  const now = useServerNow(30000);
  const offline = useSyncActivity((s) => s.offline);
  return (
    <div className="loader-frame">
      <header className="loader-topbar">
        <Link to="/loader" className="loader-location">
          <Icon name="dock" />
          {data.snapshot?.scope.depot ?? t("dock")}
        </Link>
        <time dateTime={now.toISOString()}>{formatTime(now)}</time>
        <Link className="loader-sync" data-offline={activity.offline} to="/loader/connection">
          {common(
            activity.offline
              ? "sync.offline"
              : reauth
                ? "sync.paused"
                : activity.syncing
                  ? "sync.syncing"
                  : activity.error
                    ? "sync.retrying"
                    : diagnostics.heldCount
                      ? "sync.held"
                      : diagnostics.failedItems.length
                        ? "sync.failed"
                        : diagnostics.lastSyncedAt
                          ? "sync.synced"
                          : "sync.waiting",
            { count: diagnostics.heldCount || diagnostics.failedItems.length },
          )}
          {(diagnostics.pendingCount > 0 || data.drafts.length > 0) && (
            <small>{common("sync.pending", { count: diagnostics.pendingCount + data.drafts.length })}</small>
          )}
        </Link>
        <LanguageChips language={language} chipClassName="loader-language" />
        <Link className="loader-user" to="/loader/connection">
          {user.displayName}
        </Link>
      </header>
      {offline && <Banner tone="warn" message={t("offline")} />}
      {data.error && <Banner tone="warn" message={t("saveError")} />}
      <main className="loader-main">{children}</main>
      {footer && <footer className="loader-footer">{footer}</footer>}
    </div>
  );
}
export function TripSummary({ trip, data }: { trip: TripDto; data: LoaderData }) {
  const { t } = useTranslation("loader/dock");
  const totals = loadTotals(trip, data.states);
  return (
    <section className="loader-card loader-summary">
      <Pill
        tone={trip.stops.some((s) => s.order.tempRequirement === "chilled") ? "chilled" : "neutral"}
        icon={<Icon name="reefer" />}
      >
        {trip.displayId} · {trip.brand}
      </Pill>
      <strong className="loader-departure">{formatTime(trip.plannedDepart)}</strong>
      <Countdown departure={trip.plannedDepart} />
      <p>
        {trip.district} · {t("tripNumber", { number: trip.tripNo })}
      </p>
      <CapacityBar label={t("weightLoaded")} used={totals.weight} unit={t("kg")} presentation="summary" />
      <CapacityBar label={t("volumeLoaded")} used={totals.volume} unit={t("m3")} presentation="summary" />
      <div className="loader-counts">
        <span>{t("loadedUnits", { count: totals.loaded })}</span>
        <span>{t("shortUnits", { count: totals.short })}</span>
        <span>{t("damagedUnits", { count: totals.damaged })}</span>
      </div>
    </section>
  );
}
export function ReceiptStatus({ receipt, data }: { receipt: FieldReceipt; data: LoaderData }) {
  const { t } = useTranslation("loader/dock");
  const events = receipt.events.map((e) => data.events.find((r) => r.clientEventId === e.clientEventId) ?? e);
  const text = events.some((e) => e.state === "held")
    ? "held"
    : events.some((e) => e.state === "rejected" || e.state === "failed")
      ? "failed"
      : events.some((e) => e.state === "pending" || e.state === "sending")
        ? "saved"
        : events.some(
              (e) =>
                e.confirmationFeedHead === undefined ||
                BigInt(e.confirmationFeedHead) > BigInt(data.snapshot?.feedCursor ?? "0"),
            )
          ? "awaitingSnapshot"
          : events.some((e) =>
                e.blobRefs.some((ref) => data.blobs.find((b) => b.clientBlobId === ref)?.state !== "acked"),
              )
            ? "photoPending"
            : "confirmed";
  return (
    <div className="loader-receipt">
      <Pill tone={text === "confirmed" ? "ok" : "warn"} icon={<Icon name="sync" />}>
        {t(text)}
      </Pill>
      {events.map((e) => (
        <p key={e.clientEventId} className="loader-muted">
          {t("recordedAt", {
            time: formatTime(new Date(Date.parse(e.capturedAt) + (e.clockOffsetMs ?? 0)).toISOString()),
          })}
          {e.confirmedAt && <> · {t("receivedAt", { time: formatTime(e.confirmedAt) })}</>}
        </p>
      ))}
      {events.map((e) => (e.resolution?.note ? <p key={e.clientEventId}>{e.resolution.note}</p> : null))}
      {text === "failed" && <Link to="/loader/connection">{t("connection")}</Link>}
    </div>
  );
}
export function Back({ to, label }: { to: string; label: string }) {
  return (
    <Link className="loader-back" to={to}>
      {label}
    </Link>
  );
}
export function Empty({ data }: { data: LoaderData }) {
  const { t } = useTranslation("loader/dock");
  return <p>{t(data.loaded ? "noSnapshot" : "loading")}</p>;
}
export { Button };
