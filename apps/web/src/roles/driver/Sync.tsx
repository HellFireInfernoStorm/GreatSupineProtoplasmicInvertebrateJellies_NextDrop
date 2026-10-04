import { parseEventEnvelope } from "@nextdrop/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useSession } from "../../lib/session";
import { formatTime } from "../../lib/time";
import { fieldRepository, syncController, useSyncDiagnostics } from "../../sync";
import { useSyncActivity } from "../../sync/controller";
import { Banner, Button, Sheet } from "../../ui";
import { useDriverData, planKey, type ConflictLocal } from "./data";
import { receiptEvents, capturedTime, savedDeliveryCount, recordsReceived, heldContextReady } from "./model";
import { Frame, Action, Icon } from "./parts";

function Evidence({ refs }: { refs: string[] }) {
  const { t } = useTranslation("driver/run");
  const { user } = useSession();
  const refsKey = JSON.stringify(refs);
  const [images, setImages] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    void Promise.all(
      (JSON.parse(refsKey) as string[]).map(async (ref) => {
        const blob = await fieldRepository.db.blobQueue.get(ref);
        if (blob?.userId === user.id) {
          const url = URL.createObjectURL(blob.bytes);
          urls.push(url);
        }
      }),
    ).then(() => {
      if (active) setImages([...urls]);
      else urls.forEach((url) => URL.revokeObjectURL(url));
    });
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [refsKey, user.id]);
  return (
    <>
      {images.map((src) => (
        <img key={src} className="driver-proof-image" src={src} alt={t("proofPhoto")} />
      ))}
      <p className="driver-muted">{t("proofRefs", { count: refs.length })}</p>
    </>
  );
}
function Clash({ conflicts }: { conflicts: ConflictLocal[] }) {
  const conflict = conflicts.find((c) => c.context?.fact.type === "POD_CAPTURED") ?? conflicts[0]!;
  const resolved = conflicts.every((c) => !!c.resolution);
  const { t } = useTranslation("driver/run");
  const context = conflict.context;
  const facts = conflicts.flatMap((c) => (c.context?.fact ? [parseEventEnvelope(c.context.fact)] : []));
  const changes = context?.changes ?? [];
  const refs = [
    ...new Set(
      facts.flatMap((fact) =>
        fact.type === "POD_CAPTURED"
          ? [...fact.payload.photoBlobRefs, ...(fact.payload.signatureBlobRef ? [fact.payload.signatureBlobRef] : [])]
          : [],
      ),
    ),
  ];
  return (
    <section className="driver-clash">
      <Banner
        tone={resolved ? "info" : "danger"}
        message={t(resolved ? "decisionReceived" : "clash")}
        detail={context?.original?.stop.outlet.displayId ?? t("historicalUnavailable")}
      />
      <div className="driver-comparison">
        <article className="driver-card driver-your-record">
          <h2 className="driver-eyebrow">{t("yourRecord")}</h2>
          {facts.length ? (
            facts.map((fact) => (
              <div key={fact.clientEventId ?? fact.id}>
                <strong>{t(`event.${fact.type}`, { defaultValue: fact.type })}</strong>
                <p>{t("captured", { time: formatTime(capturedTime(fact)) })}</p>
                <p className="driver-muted">{t("received", { time: formatTime(fact.receivedAt) })}</p>
                {fact.type === "STOP_OUTCOME" && <p>{t(`outcome.${fact.payload.outcome}`)}</p>}
                {fact.type === "POD_CAPTURED" && <p>{fact.payload.receiverName}</p>}
              </div>
            ))
          ) : (
            <p>{t("contextWaiting")}</p>
          )}
          {refs.length > 0 && <Evidence refs={refs} />}
        </article>
        <article className="driver-card driver-dispatch-record">
          <h2 className="driver-eyebrow">{t("dispatchChange")}</h2>
          {changes.length ? (
            changes.map((change, index) => (
              <div key={`${change.toVersion}:${index}`}>
                <strong>{t(`change.${change.kind}`)}</strong>
                <p>{formatTime(change.at)}</p>
                <p className="driver-muted">{t("versions", { from: change.fromVersion, to: change.toVersion })}</p>
                <p>
                  {change.reasonCode
                    ? t(`reason.${change.reasonCode}`, { defaultValue: change.reasonCode })
                    : t("reasonUnavailable")}
                </p>
                {change.note && <p>{change.note}</p>}
              </div>
            ))
          ) : (
            <p>{t("changeUnavailable")}</p>
          )}
        </article>
      </div>
      <Banner
        tone="info"
        icon={<Icon name="send" />}
        message={t("dispatchDecides")}
        detail={
          <>
            {!resolved && <p>{t("bothRecordsKept")}</p>}
            {conflicts
              .filter((c) => !!c.resolution)
              .map((c) => (
                <div key={c.id}>
                  <p>
                    {c.context && t(`event.${c.context.fact.type}`)} · {t(`decision.${c.resolution!.decision}`)}
                  </p>
                  {c.resolution!.note && <p>{c.resolution!.note}</p>}
                  <p>{formatTime(c.resolution!.resolvedAt)}</p>
                </div>
              ))}
          </>
        }
      />
    </section>
  );
}
export function SyncPage() {
  const { t } = useTranslation("driver/run");
  const data = useDriverData();
  const diagnostics = useSyncDiagnostics();
  const activity = useSyncActivity();
  const [peak, setPeak] = useState(diagnostics.pendingCount);
  if (diagnostics.pendingCount > peak) setPeak(diagnostics.pendingCount);
  const confirmed = data.events.filter((e) => e.state === "acked").length;
  const allSynced =
    data.loaded &&
    recordsReceived(
      { ...activity, ...diagnostics, failedCount: diagnostics.failedItems.length },
      data.events,
      data.conflicts,
    );
  const navigate = useNavigate();
  return (
    <Frame
      back
      title={t(
        diagnostics.heldCount
          ? "needsDispatch"
          : diagnostics.failedItems.length || activity.error
            ? "needsAttention"
            : allSynced
              ? "allSynced"
              : "reconnecting",
      )}
      savedCount={savedDeliveryCount(data.receipts, data.events)}
      footer={<Action onClick={() => void navigate("/driver")}>{t("backToRun")}</Action>}
    >
      {(activity.syncing || diagnostics.pendingCount > 0) && (
        <section className="driver-card">
          <h2>{t("syncProgress", { count: Math.max(0, peak - diagnostics.pendingCount), total: peak })}</h2>
          <progress max={Math.max(1, peak)} value={Math.max(0, peak - diagnostics.pendingCount)} />
          <p className="driver-muted">{t("textBeforePhotos")}</p>
        </section>
      )}
      {allSynced && (
        <>
          <div className="driver-saved-icon">
            <Icon name="double" />
          </div>
          <h2 className="driver-saved-heading">{t("allSynced")}</h2>
          <p className="driver-muted driver-saved-caption">
            {t(diagnostics.heldCount ? "bothRecordsKept" : "confirmedAll")}
          </p>
        </>
      )}
      {confirmed > 0 && <Banner tone="info" message={t("waitingSnapshot")} />}
      {Object.entries(
        data.conflicts.reduce<Record<string, ConflictLocal[]>>((groups, c) => {
          const key = c.context?.fact.subject.orderId ?? c.id;
          (groups[key] ??= []).push(c);
          return groups;
        }, {}),
      ).map(([key, conflicts]) => (
        <Clash key={key} conflicts={conflicts} />
      ))}
      {!!diagnostics.heldCount && !data.conflicts.some((c) => c.context) && (
        <Banner tone="warn" message={t("contextWaiting")} />
      )}
      {!!diagnostics.failedItems.length && (
        <Banner tone="warn" message={t("failedCount", { count: diagnostics.failedItems.length })} />
      )}
      <PlanReview data={data} />
      {activity.error && <Banner tone="warn" message={t("syncRetry")} />}
      {!allSynced && (
        <Button
          variant="secondary"
          disabled={activity.syncing || activity.offline}
          onClick={() => void syncController.syncNow()}
        >
          {t("syncNow")}
        </Button>
      )}
    </Frame>
  );
}
export function PlanReview({ data }: { data: ReturnType<typeof useDriverData> }) {
  const { t } = useTranslation("driver/run");
  const { user } = useSession();
  const snapshot = data.snapshot;
  const diagnostics = useSyncDiagnostics();
  const activity = useSyncActivity();
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const current = snapshot?.planVersion;
  const ack = data.receipts.find((r) => r.kind === "PLAN_ACK" && r.planVersion === current);
  const events = ack ? receiptEvents(ack, data.events) : [];
  const pending = events.some((e) => e.state === "pending" || e.state === "sending" || e.state === "held");
  const accepted =
    !!snapshot &&
    events.some(
      (e) =>
        e.state === "acked" &&
        e.confirmationFeedHead !== undefined &&
        BigInt(e.confirmationFeedHead) <= BigInt(snapshot.feedCursor),
    );
  useEffect(() => {
    if (accepted && snapshot) void fieldRepository.db.set(planKey(user.id, snapshot), snapshot.planVersion);
  }, [accepted, snapshot, user.id]);
  if (!snapshot || current === null || current === undefined || current === data.baseline || accepted) return null;
  if (
    activity.offline ||
    activity.syncing ||
    activity.error ||
    diagnostics.pendingCount ||
    !heldContextReady(data.events, data.conflicts) ||
    diagnostics.confirmationCount
  )
    return pending ? <Banner tone="info" message={t("ackPending")} /> : null;
  const acknowledge = async () => {
    setBusy(true);
    setError(false);
    try {
      const id = `ack:${planKey(user.id, snapshot)}:${current}`;
      await fieldRepository.enqueueBatch(
        [
          {
            type: "PLAN_ACKNOWLEDGED",
            subject:
              snapshot.role === "DRIVER"
                ? { vehicleId: snapshot.scope.vehicle.id }
                : { tripId: snapshot.scope.trips[0]!.id },
            actor: { userId: user.id, role: "DRIVER" },
            payload: { planVersion: current },
          },
        ],
        {
          id,
          userId: user.id,
          resetEpoch: snapshot.resetEpoch,
          date: snapshot.scope.date,
          tripId: snapshot.scope.trips[0]?.id ?? "",
          kind: "PLAN_ACK",
          planVersion: current,
        },
      );
      setDismissed(current);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Banner
        tone="info"
        message={t(pending ? "ackPending" : "planChanged")}
        action={
          !pending ? (
            <Button variant="ghost" onClick={() => setDismissed(null)}>
              {t("reviewPlan")}
            </Button>
          ) : undefined
        }
      />
      <Sheet open={dismissed !== current && !pending} onClose={() => setDismissed(current)} title={t("planChanged")}>
        {error && <Banner tone="warn" message={t("saveError")} />}
        {ack && !pending && !accepted && (
          <Banner tone="warn" message={t("needsAttention")} detail={t("failedCount", { count: 1 })} />
        )}
        <p>{t("reviewCurrentPlan", { version: current })}</p>
        {snapshot.scope.trips.map((trip) => (
          <section key={trip.id} className="driver-card">
            <h2>{trip.displayId}</h2>
            {trip.stops.map((stop) => (
              <p key={stop.id}>
                {stop.seq} · {stop.outlet.displayId} · {stop.outlet.district}
              </p>
            ))}
          </section>
        ))}
        {!snapshot.scope.trips.length && <p>{t("noStops")}</p>}
        <Action loading={busy} disabled={!!ack} onClick={() => void acknowledge()}>
          {t("gotIt")}
        </Action>
      </Sheet>
    </>
  );
}
