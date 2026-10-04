import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { REASON_CODES } from "@nextdrop/rules";
import type { ApiDto } from "@nextdrop/contracts";
import { ApiRequestError, type ApiResponse } from "../../lib/api";
import { formatDay, formatTime } from "../../lib/time";
import { Button, Banner, Toast } from "../../ui";
import { Pill } from "../../ui/StatusPill";
import { evaluate, validationContext, type BrowserReference, type DraftData, type Outlet } from "./planning";
import { buildDeferralReview, reviewDraft, type DeferralReviewRow } from "./deferral-review";
import type { PublishSession } from "./publish-session";
import { ValidationChecks } from "./ValidationChecks";
import priorityIcon from "./assets/d3-priority.svg";
import passedIcon from "./assets/d3-passed.svg";
import repeatIcon from "./assets/d3-repeat.svg";
import loadersIcon from "./assets/d3-loaders.svg";
import driversIcon from "./assets/d3-drivers.svg";
import storesIcon from "./assets/d3-stores.svg";
import deferralsIcon from "./assets/d3-deferrals.svg";
import riskIcon from "./assets/d3-risk.svg";

interface Props {
  day: ApiDto<"dayResponse">;
  data: DraftData;
  outlets: readonly Outlet[];
  reference: BrowserReference;
  unavailable: ReadonlySet<string>;
  breakdown: ReadonlySet<string>;
  disabled: boolean;
  session: PublishSession;
  versions: readonly ApiDto<"planVersion">[] | null;
  historyFailed: boolean;
  onHistoryRetry: () => void;
  onReload: () => void;
  onSave: (data: DraftData) => Promise<ApiDto<"draft"> | null>;
  onPublish: (revision: number) => Promise<ApiResponse<"publish">>;
  onEditingChange: (editing: boolean) => void;
}
export function DeferPublish(props: Props) {
  const { day, data, outlets, reference, unavailable, breakdown, disabled, onEditingChange } = props;
  const { t } = useTranslation("dispatcher/deferrals");
  const [edits, setEdits] = useState<DraftData | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const session = props.session;
  const publication = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const { busy, error, uncertain } = publication;
  const published = publication.response?.plan ?? null;
  const [toast, setToast] = useState(false);
  const rows = buildDeferralReview(edits ?? data, day, reference, unavailable, breakdown);
  const preview = rows.find((row) => row.order.id === previewId) ?? rows.find((row) => row.repeat) ?? rows[0];
  const candidate = reviewDraft(edits ?? data, rows);
  const validation = evaluate(
    candidate,
    day.queue,
    day.date,
    reference,
    unavailable,
    validationContext(day.planningContext, reference),
  );
  const complete = rows.filter((row) => !row.needsNote || row.note.trim()).length;
  const repeated = new Set(
    day.planningContext.outletService.filter((row) => row.deferredLastRun).map((row) => row.outletId),
  );
  const pinned = day.queue.filter((order) => repeated.has(order.outletId));
  const outletLabel = (id: string) => {
    const outlet = outlets.find((row) => row.id === id);
    return outlet ? `${outlet.displayId} · ${outlet.name}` : id;
  };
  const apiError = error instanceof ApiRequestError ? error : null;
  const conflict = apiError?.status === 409;
  // Do not allow changing a decision while an ambiguous publish response is being retried.
  const locked = disabled || busy || uncertain || !!published;
  const versions = published
    ? [published, ...(props.versions ?? []).filter((v) => v.version !== published.version)]
    : props.versions;
  function edit(row: DeferralReviewRow, change: Partial<Pick<DeferralReviewRow, "reasonCode" | "note">>) {
    setEdits(
      reviewDraft(
        candidate,
        rows.map((r) => (r.order.id === row.order.id ? { ...r, ...change } : r)),
      ),
    );
    session.reset();
    onEditingChange(true);
  }
  async function publish() {
    if (disabled || busy || published || (!uncertain && (complete !== rows.length || !validation.ok)) || conflict)
      return;
    onEditingChange(true);
    try {
      const result = await session.run(candidate, { save: props.onSave, publish: props.onPublish });
      if (result) {
        setEdits(null);
        setToast(true);
        onEditingChange(false);
      }
    } catch {
      /* The scope session keeps the error and original revision for recovery. */
    }
  }
  function note(row: DeferralReviewRow) {
    return (
      <label className="dispatch-deferral-note" htmlFor={`note-${row.order.id}`}>
        <span>{t(row.needsNote ? "justificationRequired" : "noteOptional")}</span>
        <textarea
          id={`note-${row.order.id}`}
          value={row.note}
          disabled={locked}
          required={row.needsNote}
          aria-invalid={row.needsNote && !row.note.trim()}
          aria-describedby={`consequence-${row.order.id}`}
          onChange={(event) => edit(row, { note: event.target.value })}
        />
        {row.needsNote && !row.note.trim() && (
          <small className="dispatch-danger">{t(row.repeat ? "repeatNote" : "otherNote")}</small>
        )}
      </label>
    );
  }
  return (
    <>
      {!!error && (
        <Banner
          tone="warn"
          message={t(
            conflict
              ? "conflict"
              : uncertain
                ? "uncertain"
                : apiError?.code === "MISSING_DEFERRAL_REASON"
                  ? "missingReason"
                  : "publishFailed",
          )}
          detail={conflict ? t("reloadHint") : undefined}
          action={
            conflict ? (
              <Button variant="secondary" onClick={props.onReload}>
                {t("reload")}
              </Button>
            ) : undefined
          }
        />
      )}
      {published ? (
        <section className="dispatch-card" role="status">
          <h2>{t("published")}</h2>
          <p>{t("versionSummary", { version: published.version, ...published.summary })}</p>
        </section>
      ) : (
        <div className="dispatch-defer-layout">
          <div className="dispatch-defer-review">
            <section className="dispatch-card">
              <div className="dispatch-card-heading">
                <h2>
                  <img src={priorityIcon} alt="" />
                  {t("pinned")}
                </h2>
                <small className="dispatch-muted">{t("pinnedHint")}</small>
              </div>
              {pinned.length === 0 && <p className="dispatch-muted">{t("noPinned")}</p>}
              {pinned.length > 0 && (
                <details open={pinned.some((order) => rows.some((row) => row.order.id === order.id))}>
                  <summary>
                    {t("pinnedSummary", {
                      planned: pinned.filter((order) => !rows.some((row) => row.order.id === order.id)).length,
                      deferred: pinned.filter((order) => rows.some((row) => row.order.id === order.id)).length,
                    })}
                  </summary>
                  {[...pinned]
                    .sort(
                      (a, b) =>
                        Number(rows.some((row) => row.order.id === b.id)) -
                        Number(rows.some((row) => row.order.id === a.id)),
                    )
                    .map((order) => {
                      const row = rows.find((r) => r.order.id === order.id);
                      const trip = candidate.trips.find((r) => r.orderIds.includes(order.id));
                      return (
                        <article key={order.id} className="dispatch-pinned-order" data-deferred={!!row}>
                          <div className="dispatch-card-heading">
                            <img src={row ? repeatIcon : passedIcon} alt="" />
                            <div>
                              <strong>{outletLabel(order.outletId)}</strong>
                              <small>
                                {order.displayId} · {order.brand}
                              </small>
                            </div>
                            <Pill tone={row ? "danger" : "ok"}>
                              {row ? t("deferredAgain") : t("planned", { trip: trip?.ref })}
                            </Pill>
                          </div>
                          {row && note(row)}
                        </article>
                      );
                    })}
                </details>
              )}
            </section>
            <section className="dispatch-card dispatch-deferrals-table">
              <h2>{t("deferredOrders")}</h2>
              {rows.length === 0 ? (
                <p className="dispatch-muted">{t("none")}</p>
              ) : (
                <div className="dispatch-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {["order", "outlet", "reason", "newDate", "storeNotice"].map((key) => (
                          <th key={key}>{t(key)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.order.id} data-repeat={row.repeat}>
                          <td>
                            <strong>{row.order.displayId}</strong>
                            <small>{row.order.brand}</small>
                          </td>
                          <td>{outletLabel(row.order.outletId)}</td>
                          <td>
                            <label>
                              <span className="sr-only">{t("reasonFor", { order: row.order.displayId })}</span>
                              <select
                                value={row.reasonCode}
                                disabled={locked}
                                onChange={(event) =>
                                  edit(row, { reasonCode: event.target.value as DeferralReviewRow["reasonCode"] })
                                }
                              >
                                {REASON_CODES.map((code) => (
                                  <option key={code} value={code}>
                                    {t(`reasons.${code}`)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <small>{t(`causes.${row.explanation.causeKind}`)}</small>
                            {!row.repeat &&
                              (row.needsNote || row.note ? (
                                note(row)
                              ) : (
                                <details className="dispatch-optional-note">
                                  <summary>{t("addNote")}</summary>
                                  {note(row)}
                                </details>
                              ))}
                            {apiError?.code === "MISSING_DEFERRAL_REASON" && (
                              <small className="dispatch-danger">{t("checkReason")}</small>
                            )}
                            {apiError?.validation?.violations
                              .filter((v) => v.orderIds.includes(row.order.id))
                              .map((v, index) => (
                                <small className="dispatch-danger" key={index}>
                                  {t(`dispatcher/planning:validator.${v.code}`)}
                                </small>
                              ))}
                          </td>
                          <td id={`consequence-${row.order.id}`}>
                            <strong>{formatDay(`${row.explanation.nextServiceableDate}T12:00:00+05:30`)}</strong>
                            <small>
                              {t("nextDelivery", {
                                day: new Intl.DateTimeFormat("en", {
                                  weekday: "long",
                                  timeZone: "Asia/Colombo",
                                }).format(new Date(`${row.explanation.nextServiceableDate}T12:00:00+05:30`)),
                              })}
                            </small>
                            <small>
                              {t("consequence", {
                                days: row.explanation.daysUnserved,
                                count: row.explanation.consecutiveDeferrals,
                              })}
                            </small>
                          </td>
                          <td>
                            <Pill tone={row.needsNote && !row.note.trim() ? "warn" : "ok"}>
                              {t(row.needsNote && !row.note.trim() ? "needsNote" : "ready")}
                            </Pill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="dispatch-reason-codes">
                <span>{t("reasonCodes")}</span>
                {REASON_CODES.map((code) => (
                  <Pill tone="neutral" key={code}>
                    {t(`reasons.${code}`)}
                  </Pill>
                ))}
              </div>
            </section>
          </div>
          <aside className="dispatch-card dispatch-publish-card">
            <h2>{t("publishDay", { day: formatDay(`${day.date}T12:00:00+05:30`) })}</h2>
            <p>
              <img src={validation.ok ? passedIcon : riskIcon} alt="" />
              {t("tripChecks", { count: candidate.trips.length })}
            </p>
            <p>{t("reasonsSet", { complete, total: rows.length })}</p>
            <p>
              {t("pinnedCheck", {
                count: pinned.filter((order) => {
                  const row = rows.find((r) => r.order.id === order.id);
                  return !row || Boolean(row.note.trim());
                }).length,
              })}
            </p>
            <details open={!validation.ok || !!apiError?.validation} className="dispatch-publish-checks">
              <summary>{t("checkDetails")}</summary>
              <ValidationChecks
                result={apiError?.validation ?? validation}
                serverVerified={!!apiError?.validation}
                contextAvailable
              />
            </details>
            <h3>{t("publishingUpdates")}</h3>
            <div className="dispatch-publish-recipient">
              <img src={loadersIcon} alt="" />
              {t("loaders")}
            </div>
            <div className="dispatch-publish-recipient">
              <img src={driversIcon} alt="" />
              {t("drivers", {
                count: new Set(candidate.trips.filter((trip) => trip.orderIds.length).map((trip) => trip.vehicleId))
                  .size,
              })}
            </div>
            <div className="dispatch-publish-recipient">
              <img src={storesIcon} alt="" />
              {t("storesPlanned", { count: candidate.trips.flatMap((trip) => trip.orderIds).length })}
            </div>
            <div className="dispatch-publish-recipient">
              <img src={deferralsIcon} alt="" />
              {t("storesDeferred", { count: rows.length })}
            </div>
            {preview && (
              <div className="dispatch-notice-preview">
                <h3>{t("preview")}</h3>
                <label>
                  <span className="sr-only">{t("previewOrder")}</span>
                  <select value={preview.order.id} onChange={(event) => setPreviewId(event.target.value)}>
                    {rows.map((row) => (
                      <option key={row.order.id} value={row.order.id}>
                        {row.order.displayId}
                      </option>
                    ))}
                  </select>
                </label>
                <strong>{t("noticeTitle", { order: preview.order.displayId })}</strong>
                <p>
                  {t("noticeBody", {
                    from: formatDay(`${day.date}T12:00:00+05:30`),
                    to: formatDay(`${preview.explanation.nextServiceableDate}T12:00:00+05:30`),
                    reason: t(`reasons.${preview.reasonCode}`),
                  })}
                </p>
              </div>
            )}
            <Button
              loading={busy}
              disabled={disabled || (!uncertain && (complete !== rows.length || !validation.ok)) || conflict}
              onClick={() => {
                void publish();
              }}
            >
              {t(uncertain ? "retryPublish" : "publish")}
            </Button>
            <p className="dispatch-muted">{t("publishHint")}</p>
          </aside>
        </div>
      )}
      <section className="dispatch-card dispatch-version-history">
        <h2>{t("history")}</h2>
        {props.historyFailed ? (
          <>
            <p role="alert">{t("historyFailed")}</p>
            <Button variant="secondary" onClick={props.onHistoryRetry}>
              {t("retryHistory")}
            </Button>
          </>
        ) : versions === null ? (
          <p role="status">{t("loadingHistory")}</p>
        ) : versions.length === 0 ? (
          <p>{t("noVersions")}</p>
        ) : (
          <ol>
            {[...versions]
              .sort((a, b) => b.version - a.version)
              .map((version) => (
                <li key={version.version}>
                  <strong>{t("version", { version: version.version })}</strong>
                  <span>
                    {formatDay(version.publishedAt)} · {formatTime(version.publishedAt)} · {version.publishedBy}
                  </span>
                  <small>{t("versionSummary", { version: version.version, ...version.summary })}</small>
                </li>
              ))}
          </ol>
        )}
      </section>
      <Toast open={toast} onClose={() => setToast(false)} message={t("published")} />
    </>
  );
}
