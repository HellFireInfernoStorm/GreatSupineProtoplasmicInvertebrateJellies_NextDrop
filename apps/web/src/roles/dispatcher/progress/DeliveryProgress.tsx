import { useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import type { ApiDto } from "@nextdrop/contracts";
import { Banner, Button, Toast } from "../../../ui";
import { Pill } from "../../../ui/StatusPill";
import { useServerNow } from "../../../lib/clock";
import { formatTime } from "../../../lib/time";
import { exceptionsQuery, runsQuery } from "../data";
import { Evidence, type Decision } from "./Evidence";
import {
  INBOX_TABS,
  RUN_TONES,
  actionable,
  countByTab,
  currentTrip,
  exceptionKey,
  exceptionOrderId,
  exceptionTime,
  exceptionTripId,
  finishedAt,
  linkedException,
  minutesSince,
  nextStop,
  progressPercent,
  silent,
  sortExceptions,
  sortRuns,
  stopIndex,
  summarise,
  tabOf,
  tripIndex,
  waiting,
  type Exception,
  type InboxTab,
  type Run,
  type StopPlace,
} from "./model";
import "./progress.css";

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const formatClose = (minute: number) =>
  `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/** D4 Delivery Progress (`/dispatch/runs`): today's runs on the left, the exceptions inbox and its evidence beside. */
export function DeliveryProgress({ depot }: { depot: string }) {
  const { t } = useTranslation("dispatcher/runs");
  const runs = useQuery(runsQuery(depot));
  const exceptions = useQuery(exceptionsQuery(depot));
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const [params] = useSearchParams();
  const link = { exception: params.get("exception"), order: params.get("order"), trip: params.get("trip") };
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);

  // Orders the dispatcher has seen on today's runs. A stop cancelled by a plan change leaves the runs, but its clash
  // still has to name the order and its delivery times.
  const [memory, setMemory] = useState<{ data: unknown; places: Map<string, StopPlace> }>({
    data: null,
    places: new Map(),
  });
  if (runs.data && memory.data !== runs.data)
    setMemory({ data: runs.data, places: new Map([...memory.places, ...stopIndex(runs.data.items)]) });
  const places = memory.places;
  const trips = tripIndex(runs.data?.items ?? []);

  const items = sortExceptions(exceptions.data?.items ?? []);
  const linked = linkedException(items, link);
  const [tab, setTab] = useState<InboxTab | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const activeTab: InboxTab = tab ?? (linked ? tabOf(linked) : "all");
  const visible = activeTab === "all" ? items : items.filter((item) => tabOf(item) === activeTab);
  const current =
    visible.find((item) => exceptionKey(item) === selected) ??
    (linked && visible.includes(linked) ? linked : null) ??
    visible[0] ??
    null;
  const counts = countByTab(items);
  const open = items.filter(actionable).length;

  const placeOf = (item: Exception | null): StopPlace | null => {
    if (!item) return null;
    const orderId = exceptionOrderId(item);
    return orderId ? (places.get(orderId) ?? null) : null;
  };
  const tripLabelOf = (item: Exception | null) => {
    const tripId = item ? exceptionTripId(item) : null;
    return tripId ? (trips.get(tripId)?.trip.displayId ?? null) : null;
  };

  function resolved(decision: Decision, order: string) {
    setSelected(null);
    setToast((value) => ({ id: (value?.id ?? 0) + 1, message: t(`toast.${decision}`, { order }) }));
  }

  return (
    <div className="dispatch-progress">
      <ProgressHeading runs={runs.data ?? null} />
      {(!online || runs.isError) && runs.data && (
        <Banner tone="warn" message={t("stale", { time: formatTime(runs.data.serverTime) })} />
      )}
      <div className="dispatch-progress-grid">
        <section className="dispatch-progress-runs" aria-label={t("runsHeading")}>
          {!runs.data ? (
            <div className="dispatch-card">
              <p role="status">{t(runs.isError ? "loadFailed" : "loading")}</p>
              {runs.isError && <Button onClick={() => void runs.refetch()}>{t("retry")}</Button>}
            </div>
          ) : runs.data.items.length === 0 ? (
            <p className="dispatch-card dispatch-muted">{t("noRuns")}</p>
          ) : (
            sortRuns(runs.data.items).map((run) => (
              <RunCard
                key={run.vehicle.id}
                run={run}
                linked={!!link.trip && run.trips.some((trip) => trip.id === link.trip)}
              />
            ))
          )}
        </section>

        <section className="dispatch-card dispatch-inbox" aria-labelledby="dispatch-inbox-title">
          <header className="dispatch-card-heading">
            <h2 id="dispatch-inbox-title">{t("inbox.heading")}</h2>
            {open > 0 && (
              <Pill tone="danger" icon={<span />}>
                {t("inbox.open", { count: open })}
              </Pill>
            )}
          </header>
          <div className="dispatch-inbox-tabs" role="tablist" aria-label={t("inbox.heading")}>
            {INBOX_TABS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={activeTab === key}
                onClick={() => {
                  setTab(key);
                  setSelected(null);
                }}
              >
                {t(`inbox.tabs.${key}`)}
                <span>{counts[key]}</span>
              </button>
            ))}
          </div>
          {!exceptions.data ? (
            <div className="dispatch-inbox-state">
              <p role="status">{t(exceptions.isError ? "inboxLoadFailed" : "loading")}</p>
              {exceptions.isError && <Button onClick={() => void exceptions.refetch()}>{t("retry")}</Button>}
            </div>
          ) : visible.length === 0 ? (
            <p className="dispatch-inbox-state dispatch-muted">{t("inbox.empty")}</p>
          ) : (
            <ul className="dispatch-inbox-list" role="tabpanel">
              {visible.map((item) => {
                const key = exceptionKey(item);
                return (
                  <li key={key}>
                    <InboxItem
                      item={item}
                      place={placeOf(item)}
                      tripLabel={tripLabelOf(item)}
                      selected={current !== null && exceptionKey(current) === key}
                      onSelect={() => setSelected(key)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <Evidence
          item={current}
          place={placeOf(current)}
          tripLabel={tripLabelOf(current)}
          depot={depot}
          online={online}
          onResolved={resolved}
        />
      </div>
      <Toast open={toast !== null} notificationId={toast?.id} message={toast?.message} onClose={() => setToast(null)} />
    </div>
  );
}

function ProgressHeading({ runs }: { runs: ApiDto<"runsResponse"> | null }) {
  const { t } = useTranslation("dispatcher/runs");
  const summary = runs ? summarise(runs.items) : null;
  const chips = summary
    ? ([
        ["outForDelivery", summary.outForDelivery, "deferred"],
        ["delivered", summary.delivered, "ok"],
        ["lateRisk", summary.lateRisk, "warn"],
        ["noSignal", summary.noSignal, "neutral"],
        ["later", summary.later, "neutral"],
      ] as const)
    : [];
  return (
    <header className="dispatch-progress-heading">
      <p className="dispatch-muted">
        {runs ? t("subtitle", { time: formatTime(runs.serverTime) }) : t("subtitleLoading")}
      </p>
      <ul className="dispatch-progress-chips" aria-label={t("runsHeading")}>
        {chips
          .filter(([, count]) => count > 0)
          .map(([key, count, tone]) => (
            <li key={key}>
              <Pill tone={tone} icon={<span />}>
                {t(`summary.${key}`, { count })}
              </Pill>
            </li>
          ))}
      </ul>
    </header>
  );
}

function RunCard({ run, linked }: { run: Run; linked: boolean }) {
  const { t } = useTranslation(["dispatcher/runs", "dispatcher/planning"]);
  const now = useServerNow(30_000);
  const trip = currentTrip(run);
  const later = waiting(run);
  const isSilent = silent(run);
  const tone = later ? "neutral" : run.state === "ON_TRACK" && run.lateRisk ? "warn" : RUN_TONES[run.state];
  const label = run.state === "ON_TRACK" ? (run.lateRisk ? "LATE_RISK" : later ? "LATER" : "ON_TRACK") : run.state;
  const next = nextStop(run);
  const finished = run.state === "DONE" ? finishedAt(run) : null;
  const percent = progressPercent(run);
  const district = trip?.district ?? "";

  let status: string;
  if (isSilent)
    status = [
      run.lastHeardAt
        ? t("card.lastHeard", {
            time: formatTime(run.lastHeardAt),
            minutes: minutesSince(run.lastHeardAt, now.getTime()),
          })
        : t("card.neverHeard"),
      t("card.progress", { done: run.stopsDone, total: run.stopsTotal }),
      district,
    ].join(" · ");
  else if (finished) status = t("card.finished", { time: formatTime(finished), count: run.stopsTotal });
  else if (later && trip) status = t("card.leaves", { time: formatTime(trip.plannedDepart), count: trip.stops.length });
  else
    status = [
      run.lastSyncAt ? t("card.lastSync", { time: formatTime(run.lastSyncAt) }) : t("card.neverSynced"),
      ...(next && (run.lateRisk || run.state === "BEHIND")
        ? [
            t("card.next", {
              outlet: next.outlet.displayId,
              name: next.outlet.name,
              close: formatClose(next.window.close),
            }),
          ]
        : []),
      ...(run.pendingCount > 0 ? [t("card.pending", { count: run.pendingCount })] : []),
    ].join(" · ");

  const note =
    run.state === "ESCALATED"
      ? t("card.escalatedNote", { phone: run.vehicle.driver.phone })
      : run.state === "NO_SIGNAL"
        ? t("card.noSignalNote")
        : run.state === "BEHIND"
          ? t("card.behindNote")
          : null;

  return (
    <article
      className="dispatch-run-card"
      data-state={run.state}
      data-tone={tone}
      data-linked={linked || undefined}
      aria-label={`${trip?.displayId ?? run.vehicle.displayId} ${t(`card.state.${label}`)}`}
    >
      <header>
        <h3>{trip?.displayId ?? run.vehicle.displayId}</h3>
        <span className="dispatch-run-meta">
          {t("card.meta", {
            vehicle: run.vehicle.displayId,
            district,
            brand: trip ? t(`dispatcher/planning:brands.${trip.brand}`) : "",
          })}
          {run.trips.length > 1 && trip && <> · {t("card.trips", { number: trip.tripNo, count: run.trips.length })}</>}
        </span>
        <Pill tone={tone} icon={<span />}>
          {t(`card.state.${label}`)}
        </Pill>
      </header>
      <div className="dispatch-run-progress">
        <div
          className="dispatch-run-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={run.stopsTotal}
          aria-valuenow={run.stopsDone}
          aria-label={t("card.progressLabel", { done: run.stopsDone, total: run.stopsTotal })}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <strong>{t("card.progress", { done: run.stopsDone, total: run.stopsTotal })}</strong>
      </div>
      <p className="dispatch-run-status">
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          {isSilent ? (
            <path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18" />
          ) : (
            <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2" />
          )}
        </svg>
        {status}
      </p>
      {note && <p className="dispatch-run-note">{note}</p>}
      {isSilent && run.pendingCount > 0 && (
        <p className="dispatch-run-note">{t("card.pending", { count: run.pendingCount })}</p>
      )}
    </article>
  );
}

function InboxItem({
  item,
  place,
  tripLabel,
  selected,
  onSelect,
}: {
  item: Exception;
  place: StopPlace | null;
  tripLabel: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation("dispatcher/runs");
  const order = place?.stop.order ?? (item.type === "FAILED" ? item.order : null);
  const outlet = place?.stop.outlet;
  const title =
    item.type === "ACK"
      ? t("inbox.tripTitle", { trip: tripLabel ?? "" })
      : order && outlet
        ? t("inbox.orderTitle", { order: order.displayId, outlet: outlet.displayId, name: outlet.name })
        : (order?.displayId ?? t("inbox.unknownOrder"));
  const line =
    order && (item.type === "SHORT" || item.type === "DAMAGED")
      ? order.lines.find((l) => l.id === item.lineId)?.name
      : undefined;
  const detail =
    item.type === "CONFLICT"
      ? t(`conflictKind.${item.conflict.kind}`)
      : item.type === "ISSUE"
        ? t("inbox.issueLine", { kind: t(`issueKind.${item.issue.kind}`) })
        : item.type === "SHORT"
          ? item.resolution === "HOLD_TRIP"
            ? t("inbox.shortHeld")
            : t("inbox.shortLine", { qty: item.qtyShort, line: line ?? item.lineId })
          : item.type === "DAMAGED"
            ? t("inbox.damagedLine", { qty: item.qty, line: line ?? item.lineId })
            : item.type === "FAILED"
              ? t("inbox.failedLine")
              : item.type === "PROBLEM"
                ? t(`problemKind.${item.kind}`)
                : t("inbox.ackLine", { version: item.planVersion });
  const photos = "evidence" in item ? item.evidence.length : 0;
  const time = exceptionTime(item);
  const tone = item.type === "ACK" ? "ok" : item.type === "SHORT" || item.type === "PROBLEM" ? "warn" : "danger";
  return (
    <button type="button" className="dispatch-inbox-item" aria-pressed={selected} data-tone={tone} onClick={onSelect}>
      <span className="dispatch-inbox-icon" data-tone={tone} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
          {item.type === "ACK" ? (
            <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M8 12l3 3 5-6" />
          ) : item.type === "CONFLICT" ? (
            <path d="M7 4v13M7 17l-3-3M7 17l3-3M17 20V7M17 7l-3 3M17 7l3 3" />
          ) : item.type === "SHORT" || item.type === "PROBLEM" ? (
            <path d="M5 21V4h11l-2 4 2 4H5" />
          ) : (
            <path d="M12 3 2 20h20zM12 10v4M12 17h.01" />
          )}
        </svg>
      </span>
      <span className="dispatch-inbox-body">
        <strong>{title}</strong>
        <Pill tone={tone} icon={<span />}>
          {t(`inbox.type.${item.type}`)}
        </Pill>
        <span>
          {detail}
          {photos > 0 && <> · {t("inbox.photos", { count: photos })}</>}
        </span>
        {time && <small>{formatTime(time)}</small>}
      </span>
    </button>
  );
}
