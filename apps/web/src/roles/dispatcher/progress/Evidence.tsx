import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { SHORT_OUTCOMES } from "@nextdrop/contracts";
import { Banner, Button, StatusPill } from "../../../ui";
import { callApi, ApiRequestError } from "../../../lib/api";
import { formatTime } from "../../../lib/time";
import { exceptionKey, tabOf, type Exception, type StopPlace } from "./model";

type ShortOutcome = (typeof SHORT_OUTCOMES)[number];
export type Decision = "ACCEPT_FACT" | "REJECT_FACT" | "CREDIT" | "ADD_TO_RUN" | "REJECT" | ShortOutcome;

interface Props {
  item: Exception | null;
  place: StopPlace | null;
  tripLabel: string | null;
  depot: string;
  online: boolean;
  onResolved: (decision: Decision, order: string) => void;
}

/** A photo or signature through the authorised blob read (`GET /api/blobs/:id`, ADR 0035), or a grey placeholder. */
function Photo({ id, label, index }: { id: string | null; label: string; index: number }) {
  const { t } = useTranslation("dispatcher/runs");
  const [failed, setFailed] = useState(false);
  if (!id || failed)
    return (
      <span className="dispatch-photo" data-empty="true">
        <svg
          viewBox="0 0 24 24"
          width="28"
          height="28"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M4 7h3l2-2h6l2 2h3v12H4zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6" />
        </svg>
        <span className="dispatch-visually-hidden">{t("detail.noPhoto")}</span>
      </span>
    );
  const src = `/api/blobs/${encodeURIComponent(id)}`;
  return (
    <a className="dispatch-photo" href={src} target="_blank" rel="noreferrer" title={t("detail.openPhoto")}>
      <img src={src} alt={t("detail.photoAlt", { label, index: index + 1 })} onError={() => setFailed(true)} />
    </a>
  );
}

function EvidenceColumn({
  title,
  caption,
  photos,
  empty,
}: {
  title: string;
  caption?: ReactNode;
  photos: readonly string[];
  empty?: ReactNode;
}) {
  return (
    <figure className="dispatch-evidence-column">
      {photos.length ? (
        photos.map((id, index) => <Photo key={id} id={id} label={title} index={index} />)
      ) : (
        <Photo id={null} label={title} index={0} />
      )}
      <figcaption>
        <strong>{title}</strong>
        {photos.length === 0 && empty ? <small>{empty}</small> : caption && <small>{caption}</small>}
      </figcaption>
    </figure>
  );
}

export function Evidence({ item, place, tripLabel, depot, online, onResolved }: Props) {
  const { t } = useTranslation("dispatcher/runs");
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState<"failed" | "alreadyResolved" | null>(null);
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [outcome, setOutcome] = useState<ShortOutcome | null>(null);
  const [itemKey, setItemKey] = useState<string | null>(null);
  const key = item ? exceptionKey(item) : null;
  // A different item starts a clean form.
  if (key !== itemKey) {
    setItemKey(key);
    setBusy(null);
    setError(null);
    setNote("");
    setRejecting(false);
    setOutcome(null);
  }

  if (!item)
    return (
      <section className="dispatch-card dispatch-evidence" aria-labelledby="dispatch-evidence-title">
        <h2 id="dispatch-evidence-title" className="dispatch-visually-hidden">
          {t("inbox.heading")}
        </h2>
        <p className="dispatch-muted">{t("detail.empty")}</p>
      </section>
    );

  const order = place?.stop.order ?? (item.type === "FAILED" ? item.order : null);
  const orderLabel = order?.displayId ?? t("detail.noOrder");
  const outlet = place?.stop.outlet;
  const vehicle = place?.run.vehicle;

  async function decide(decision: Decision, call: () => Promise<unknown>) {
    setBusy(decision);
    setError(null);
    try {
      await call();
      onResolved(decision, orderLabel);
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError && (cause.status === 409 || cause.status === 404)
          ? "alreadyResolved"
          : "failed",
      );
    } finally {
      setBusy(null);
      void queryClient.invalidateQueries({ queryKey: ["dispatch", depot, "exceptions"] });
      void queryClient.invalidateQueries({ queryKey: ["dispatch", depot, "runs"] });
    }
  }
  const trimmed = note.trim();
  const optionalNote = trimmed ? { note: trimmed } : {};
  const disabled = !online || busy !== null;

  const title =
    item.type === "CONFLICT"
      ? t("detail.clashTitle", { order: orderLabel })
      : item.type === "ISSUE"
        ? t("detail.issueTitle", { order: orderLabel })
        : item.type === "SHORT"
          ? t("detail.shortTitle", { order: orderLabel })
          : item.type === "DAMAGED"
            ? t("detail.damagedTitle", { order: orderLabel })
            : item.type === "FAILED"
              ? t("detail.failedTitle", { order: orderLabel })
              : item.type === "PROBLEM"
                ? t("detail.problemTitle", { order: orderLabel })
                : t("detail.ackTitle", { trip: tripLabel ?? "" });
  const line =
    order && (item.type === "SHORT" || item.type === "DAMAGED")
      ? order.lines.find((l) => l.id === item.lineId)
      : undefined;

  const rows: [string, ReactNode][] = [];
  if (place?.stop.deliveredAt)
    rows.push([
      t("detail.rows.delivered"),
      t("detail.rows.deliveredValue", { time: formatTime(place.stop.deliveredAt) }),
    ]);
  if (place?.stop.deliveredAt)
    rows.push([
      t("detail.rows.confirmed"),
      place.stop.confirmedAt
        ? t("detail.rows.confirmedValue", { time: formatTime(place.stop.confirmedAt) })
        : t("detail.rows.notConfirmed"),
    ]);
  if (item.type === "CONFLICT") {
    rows.unshift([t("detail.rows.kind"), t(`conflictKind.${item.conflict.kind}`)]);
    rows.push([t("detail.rows.opened"), formatTime(item.conflict.openedAt)]);
  }
  if (item.type === "ISSUE") {
    rows.push([
      t("detail.rows.reported"),
      t("detail.rows.reportedValue", {
        kind: t(`issueKind.${item.issue.kind}`),
        time: formatTime(item.issue.openedAt),
      }),
    ]);
    if (item.issue.note) rows.push([t("detail.rows.note"), item.issue.note]);
  }
  if (item.type === "SHORT")
    rows.push([
      t("detail.rows.short"),
      t("detail.rows.shortValue", { qty: item.qtyShort, line: line?.name ?? item.lineId }),
    ]);
  if (item.type === "PROBLEM" && item.note) rows.push([t("detail.rows.note"), item.note]);
  if (place)
    rows.push([t("detail.rows.stop"), t("detail.rows.stopValue", { seq: place.stop.seq, trip: place.trip.displayId })]);

  return (
    <section
      className="dispatch-card dispatch-evidence"
      aria-labelledby="dispatch-evidence-title"
      data-kind={tabOf(item)}
    >
      <header>
        <h2 id="dispatch-evidence-title">{title}</h2>
        {outlet && vehicle && place && order && (
          <p className="dispatch-muted">
            {t("detail.meta", {
              outlet: outlet.displayId,
              name: outlet.name,
              trip: place.trip.displayId,
              vehicle: vehicle.displayId,
              temp: t(`detail.temp.${order.tempRequirement}`),
            })}
          </p>
        )}
        {order && <StatusPill status={order.status} />}
      </header>

      {item.type === "CONFLICT" && (
        <div className="dispatch-evidence-pair">
          <figure className="dispatch-evidence-column dispatch-plan-change">
            <div>
              <svg
                viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M6 3h9l3 3v15H6zM9 11l6 6M15 11l-6 6" />
              </svg>
              <p>
                {t("detail.planChangeBody", {
                  kind: t(`conflictKind.${item.conflict.kind}`),
                  time: formatTime(item.conflict.openedAt),
                })}
              </p>
              {item.conflict.note && <p>{t("detail.planChangeNote", { note: item.conflict.note })}</p>}
            </div>
            <figcaption>
              <strong>{t("detail.planChange")}</strong>
              <small>{formatTime(item.conflict.openedAt)}</small>
            </figcaption>
          </figure>
          <EvidenceColumn
            title={t("detail.driverProof")}
            photos={item.evidence}
            caption={
              place?.stop.deliveredAt
                ? `${vehicle?.driver.name ?? ""} · ${formatTime(place.stop.deliveredAt)}`
                : vehicle?.driver.name
            }
          />
        </div>
      )}
      {item.type === "ISSUE" && (
        <div className="dispatch-evidence-pair">
          {/* Stores cannot upload photos in this build (ADR 0035): the store's side is its report. Every photo the
              exception carries is the driver's proof of delivery. */}
          <EvidenceColumn title={t("detail.storePhoto")} photos={[]} empty={t("detail.noStorePhoto")} />
          <EvidenceColumn
            title={t("detail.driverProof")}
            photos={item.evidence}
            caption={
              place?.stop.deliveredAt
                ? `${vehicle?.driver.name ?? ""} · ${formatTime(place.stop.deliveredAt)}`
                : vehicle?.driver.name
            }
          />
        </div>
      )}
      {(item.type === "DAMAGED" || item.type === "PROBLEM") && (
        <div className="dispatch-evidence-pair">
          <EvidenceColumn
            title={t(item.type === "DAMAGED" ? "detail.loaderPhoto" : "detail.driverPhoto")}
            photos={item.evidence}
          />
        </div>
      )}

      {rows.length > 0 && (
        <dl className="dispatch-evidence-rows">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <p className="dispatch-muted">
        {t(
          item.type === "CONFLICT"
            ? "detail.clashHint"
            : item.type === "ISSUE" || item.type === "SHORT"
              ? "detail.hint"
              : "detail.infoHint",
        )}
      </p>

      {!online && <Banner tone="warn" message={t("actions.offline")} />}
      {error && <Banner tone="danger" message={t(`actions.${error}`)} urgent />}

      {item.type === "CONFLICT" && (
        <div className="dispatch-evidence-actions">
          <label className="dispatch-note">
            {t("detail.noteLabel")}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} />
          </label>
          <div className="dispatch-actions">
            <Button
              variant="secondary"
              disabled={disabled}
              loading={busy === "REJECT_FACT"}
              onClick={() =>
                void decide("REJECT_FACT", () =>
                  callApi("resolveConflict", {
                    params: { id: item.conflict.id },
                    body: { resolution: "REJECT_FACT", ...optionalNote },
                  }),
                )
              }
            >
              {t("actions.rejectFact")}
            </Button>
            <Button
              disabled={disabled}
              loading={busy === "ACCEPT_FACT"}
              onClick={() =>
                void decide("ACCEPT_FACT", () =>
                  callApi("resolveConflict", {
                    params: { id: item.conflict.id },
                    body: { resolution: "ACCEPT_FACT", ...optionalNote },
                  }),
                )
              }
            >
              {t("actions.acceptFact")}
            </Button>
          </div>
        </div>
      )}

      {item.type === "ISSUE" && (
        <div className="dispatch-evidence-actions">
          {rejecting ? (
            <>
              <label className="dispatch-note">
                {t("detail.rejectNoteLabel")}
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={500}
                  aria-describedby="dispatch-reject-help"
                  required
                />
              </label>
              {!trimmed && (
                <small id="dispatch-reject-help" className="dispatch-muted">
                  {t("detail.rejectNoteRequired")}
                </small>
              )}
              <div className="dispatch-actions">
                <Button variant="ghost" disabled={busy !== null} onClick={() => setRejecting(false)}>
                  {t("actions.cancel")}
                </Button>
                <Button
                  variant="danger"
                  disabled={disabled || !trimmed}
                  loading={busy === "REJECT"}
                  onClick={() =>
                    void decide("REJECT", () =>
                      callApi("resolveIssue", {
                        params: { id: item.issue.id },
                        body: { resolution: "REJECT", note: trimmed },
                      }),
                    )
                  }
                >
                  {t("actions.confirmReject")}
                </Button>
              </div>
            </>
          ) : (
            <div className="dispatch-actions dispatch-actions-stack">
              <Button
                variant="secondary"
                disabled={disabled}
                loading={busy === "CREDIT"}
                onClick={() =>
                  void decide("CREDIT", () =>
                    callApi("resolveIssue", { params: { id: item.issue.id }, body: { resolution: "CREDIT" } }),
                  )
                }
              >
                {t("actions.credit")}
              </Button>
              <Button variant="secondary" disabled={disabled} onClick={() => setRejecting(true)}>
                {t("actions.reject")}
              </Button>
              <Button
                size="lg"
                disabled={disabled}
                loading={busy === "ADD_TO_RUN"}
                onClick={() =>
                  void decide("ADD_TO_RUN", () =>
                    callApi("resolveIssue", { params: { id: item.issue.id }, body: { resolution: "ADD_TO_RUN" } }),
                  )
                }
              >
                {t("actions.addToRun")}
              </Button>
            </div>
          )}
        </div>
      )}

      {item.type === "SHORT" && (
        <div className="dispatch-evidence-actions">
          <fieldset className="dispatch-short-choices" disabled={disabled}>
            <legend>{t("actions.shortChoice")}</legend>
            {SHORT_OUTCOMES.map((value) => {
              // The system proposes shipping partial (ADR 0005); a trip already held shows that decision instead.
              const chosen = outcome ?? item.resolution ?? "SHIP_PARTIAL";
              return (
                <label key={value} data-checked={chosen === value}>
                  <input
                    type="radio"
                    name="short-outcome"
                    value={value}
                    checked={chosen === value}
                    onChange={() => setOutcome(value)}
                  />
                  <span>
                    <strong>
                      {t(`actions.${value}`)}
                      {value === "SHIP_PARTIAL" && <em>{t("actions.proposed")}</em>}
                    </strong>
                    <small>{t(`actions.${value}_help`)}</small>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <label className="dispatch-note">
            {t("detail.noteLabel")}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} />
          </label>
          <div className="dispatch-actions">
            <Button
              size="lg"
              disabled={disabled}
              loading={busy !== null}
              onClick={() => {
                const chosen = outcome ?? item.resolution ?? "SHIP_PARTIAL";
                void decide(chosen, () =>
                  callApi("resolveShort", {
                    params: { id: item.orderId, lineId: item.lineId },
                    body: { outcome: chosen, ...optionalNote },
                  }),
                );
              }}
            >
              {t("actions.confirmShort")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
