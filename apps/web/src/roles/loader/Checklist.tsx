import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { uuidv7 } from "uuidv7";
import { useSession } from "../../lib/session";
import { clockOffsetMs, useServerNow } from "../../lib/clock";
import { fieldRepository } from "../../sync";
import { compressPhoto } from "../../sync/blobs";
import { Banner, Button, QuantityStepper, Sheet } from "../../ui";
import { Pill } from "../../ui/StatusPill";
import type { LoaderData } from "./data";
import { loadOrder, loadIntents, orderGate, type Stop, type Line } from "./model";
import { saveDraft, loadKey, undoDraft } from "./drafts";
import { Frame, TripSummary, Back, Empty, Icon, ReceiptStatus } from "./parts";
import { PlanReview } from "./Review";
import type { TripDto } from "@nextdrop/contracts";
export function Evidence({ bytes }: { bytes: Blob }) {
  const { t } = useTranslation("loader/dock");
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const value = URL.createObjectURL(bytes);
    if (image.current) image.current.src = value;
    return () => URL.revokeObjectURL(value);
  }, [bytes]);
  return <img ref={image} className="loader-evidence" alt={t("photoEvidence")} />;
}
type Report = { stop: Stop; line: Line; kind: "short" | "damaged"; missing: number };
function ReportSheet({
  report,
  trip,
  data,
  onClose,
  onSave,
}: {
  report: Report;
  trip: TripDto;
  data: LoaderData;
  onClose: () => void;
  onSave: (input: Report & { quantity: number; reason: string; photo?: File }) => Promise<void>;
}) {
  const { t } = useTranslation("loader/dock");
  const [quantity, setQuantity] = useState(Math.min(1, report.missing));
  const [reason, setReason] = useState("");
  const [photo, setPhoto] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const reasons =
    report.kind === "short" ? data.snapshot!.config.reasons.loadShort : data.snapshot!.config.reasons.loadDamaged;
  return (
    <Sheet
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={t(report.kind === "short" ? "reportShort" : "reportDamaged")}
    >
      <p>
        {report.stop.outlet.displayId} · {report.line.name} · {trip.displayId}
      </p>
      <p>{t("reportRemainder")}</p>
      <QuantityStepper label={t("quantity")} value={quantity} onChange={setQuantity} min={1} max={report.missing} />
      <div className="loader-actions">
        <Button variant="secondary" onClick={() => setQuantity(report.missing)}>
          {t("all", { count: report.missing })}
        </Button>
        <Button variant="secondary" onClick={() => setQuantity(Math.max(1, Math.floor(report.missing / 2)))}>
          {t("half")}
        </Button>
      </div>
      <fieldset className="loader-reasons">
        <legend>{t("why")}</legend>
        {reasons.map((r) => (
          <Button
            key={r.code}
            variant={reason === r.code ? "primary" : "secondary"}
            aria-pressed={reason === r.code}
            icon={<Icon name="damaged" />}
            onClick={() => setReason(r.code)}
          >
            {t(r.message_key)}
          </Button>
        ))}
      </fieldset>
      <label className="loader-photo">
        <Icon name="photo" />
        {t("takePhoto")}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={busy}
          onChange={(e) => setPhoto(e.target.files?.[0])}
        />
      </label>
      <p className="loader-muted">{t(report.kind === "damaged" ? "photoRequired" : "photoOptional")}</p>
      {photo && <Evidence bytes={photo} />}
      {error && <Banner tone="warn" message={t("saveError")} />}
      <Button
        size="lg"
        variant="ok"
        icon={<Icon name="send" />}
        loading={busy}
        disabled={!reason || (report.kind === "damaged" && !photo)}
        onClick={() => {
          setBusy(true);
          setError(false);
          void onSave({ ...report, quantity, reason, photo })
            .then(onClose)
            .catch(() => setError(true))
            .finally(() => setBusy(false));
        }}
      >
        {t("sendReport")}
      </Button>
    </Sheet>
  );
}
export function Checklist({ data }: { data: LoaderData }) {
  const { t } = useTranslation("loader/dock");
  const { user } = useSession();
  const { tripId } = useParams();
  const deviceNow = useServerNow(250).getTime() - clockOffsetMs();
  const trip = data.snapshot?.scope.trips.find((trip) => trip.id === tripId);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (!trip || !data.snapshot)
    return (
      <Frame data={data}>
        <Empty data={data} />
        <Back to="/loader" label={t("trips")} />
      </Frame>
    );
  const snapshot = data.snapshot;
  const stops = loadOrder(trip);
  const checked = stops.filter(
    (s) => data.states[s.order.id] && !orderGate(s, data.states[s.order.id]!).incompleteLines.length,
  ).length;
  const editable = trip.status === "PLANNED";
  const stage = async (
    stop: Stop,
    line: Line,
    kind: "loaded" | "short" | "damaged",
    quantity?: number,
    reason?: string,
    photo?: File,
  ) => {
    const state = data.states[stop.order.id];
    if (!state || !editable || busy || snapshot.planVersion === null) throw new Error("Checklist unavailable");
    setBusy(true);
    setError(false);
    try {
      const bytes = photo ? await compressPhoto(photo) : undefined;
      const clientBlobId = bytes ? uuidv7() : undefined;
      const intents = loadIntents({
        stop,
        trip,
        line,
        state,
        userId: user.id,
        kind,
        quantity,
        reason,
        photoRef: clientBlobId,
      });
      await saveDraft(fieldRepository, {
        label: `${stop.outlet.displayId} · ${line.name}`,
        receipt: {
          id: loadKey(user.id, snapshot, stop.order.id, line.id),
          userId: user.id,
          resetEpoch: snapshot.resetEpoch,
          date: snapshot.scope.date,
          tripId: trip.id,
          orderId: stop.order.id,
          kind: "LOAD",
          planVersion: snapshot.planVersion,
        },
        intents,
        capturedAt: new Date().toISOString(),
        clockOffsetMs: clockOffsetMs(),
        ...(bytes && clientBlobId
          ? { blob: { clientBlobId, bytes, userId: user.id, state: "pending", attempts: 0, lastError: null } }
          : {}),
      });
    } catch (err) {
      setError(true);
      throw err;
    } finally {
      setBusy(false);
    }
  };
  return (
    <Frame
      data={data}
      footer={
        <div className="loader-readybar">
          <div>
            <strong>{t("checkedCount", { count: checked, total: stops.length })}</strong>
            <p className="loader-muted">{t("checkEveryRow")}</p>
          </div>
          <Link className="loader-back" to={`/loader/trips/${trip.id}/ready`}>
            {t("reviewReady")}
          </Link>
        </div>
      }
    >
      <PlanReview data={data} />
      {error && <Banner tone="warn" message={t("saveError")} />}
      <div className="loader-checklist">
        <aside>
          <TripSummary trip={trip} data={data} />
          <section className="loader-card">
            <h2>{t("cabFirst")}</h2>
            <ol className="loader-truck">
              {stops.map((s) => (
                <li key={s.id}>
                  {s.outlet.displayId} · {t("stopNumber", { number: s.seq })}
                </li>
              ))}
            </ol>
            <p className="loader-muted">{t("rearDoors")}</p>
          </section>
        </aside>
        <div className="loader-rows">
          <div className="loader-heading">
            <Back to="/loader" label={t("trips")} />
            <div>
              <h1>
                <Icon name="arrow" />
                {t("loadThisOrder")}
              </h1>
              <p className="loader-muted">{t("loadInstruction")}</p>
            </div>
          </div>
          {stops.map((stop, index) => {
            const state = data.states[stop.order.id];
            return (
              <section
                className="loader-card loader-order"
                key={stop.id}
                data-chilled={stop.order.tempRequirement === "chilled"}
              >
                <div className="loader-order-heading">
                  <span className="loader-position">{index + 1}</span>
                  <div>
                    <h2>
                      {stop.outlet.displayId} · {stop.outlet.name}
                    </h2>
                    <p className="loader-muted">
                      {t("stopNumber", { number: stop.seq })} · {stop.order.displayId}
                    </p>
                    <Pill tone="neutral" icon={<Icon name="dock" />}>
                      {t(`dockType.${stop.outlet.dockType}`)}
                    </Pill>
                    {stop.order.tempRequirement === "chilled" && (
                      <Pill tone="chilled" icon={<Icon name="reefer" />}>
                        {t("chilled")}
                      </Pill>
                    )}
                  </div>
                </div>
                {stop.order.lines.map((line) => {
                  const missing = state
                    ? (orderGate(stop, state).incompleteLines.find((l) => l.lineId === line.id)?.missing ?? 0)
                    : line.qtyOrdered;
                  const id = loadKey(user.id, snapshot, stop.order.id, line.id);
                  const receipt = data.receipts.find((r) => r.id === id);
                  const draft = data.drafts.find((d) => d.receipt.id === id);
                  const locked =
                    !editable ||
                    busy ||
                    !!draft ||
                    !!receipt ||
                    !state ||
                    !(state.status === "PLANNED" || state.status === "LOADED") ||
                    !!state.pendingReversal;
                  const short =
                    state?.short.filter((l) => l.lineId === line.id).reduce((sum, l) => sum + l.qtyShort, 0) ?? 0;
                  const damaged =
                    state?.damaged.filter((l) => l.lineId === line.id).reduce((sum, l) => sum + l.qty, 0) ?? 0;
                  return (
                    <div className="loader-line" key={line.id}>
                      <div>
                        <strong>{line.name}</strong>
                        <p>{t("orderedUnits", { count: line.qtyOrdered })}</p>
                        {short > 0 && (
                          <Pill tone="warn" icon={<Icon name="flag" />}>
                            {t("shortUnits", { count: short })}
                          </Pill>
                        )}
                        {damaged > 0 && (
                          <Pill tone="danger" icon={<Icon name="damaged" />}>
                            {t("damagedUnits", { count: damaged })}
                          </Pill>
                        )}
                      </div>
                      {missing > 0 && (
                        <div className="loader-actions">
                          <Button
                            variant="ok"
                            size="lg"
                            icon={<Icon name="check" />}
                            disabled={locked}
                            onClick={() => void stage(stop, line, "loaded").catch(() => undefined)}
                          >
                            {t("loaded")}
                          </Button>
                          <Button
                            variant="secondary"
                            size="lg"
                            icon={<Icon name="flag" />}
                            disabled={locked}
                            onClick={() => setReport({ stop, line, kind: "short", missing })}
                          >
                            {t("short")}
                          </Button>
                          <Button
                            variant="secondary"
                            size="lg"
                            icon={<Icon name="damaged" />}
                            disabled={locked}
                            onClick={() => setReport({ stop, line, kind: "damaged", missing })}
                          >
                            {t("damaged")}
                          </Button>
                        </div>
                      )}
                      {!missing && (
                        <Pill tone="ok" icon={<Icon name="check" />}>
                          {t("checked")}
                        </Pill>
                      )}
                      {draft && (
                        <div className="loader-receipt">
                          <p>{t("draftSaved")}</p>
                          <Button
                            variant="secondary"
                            icon={<Icon name="undo" />}
                            disabled={deviceNow >= draft.expiresAt}
                            onClick={() =>
                              void undoDraft(fieldRepository, draft.key, user.id).catch(() => setError(true))
                            }
                          >
                            {t("undo")}
                          </Button>
                          {draft.blob && <Evidence bytes={draft.blob.bytes} />}
                        </div>
                      )}
                      {receipt && <ReceiptStatus receipt={receipt} data={data} />}
                      {receipt?.events
                        .flatMap((e) => e.blobRefs)
                        .map((ref) => {
                          const blob = data.blobs.find((b) => b.clientBlobId === ref);
                          return blob ? <Evidence key={ref} bytes={blob.bytes} /> : null;
                        })}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>
      {report && (
        <ReportSheet
          key={`${report.stop.id}:${report.line.id}:${report.kind}`}
          report={report}
          trip={trip}
          data={data}
          onClose={() => setReport(null)}
          onSave={(r) => stage(r.stop, r.line, r.kind, r.quantity, r.reason, r.photo)}
        />
      )}
    </Frame>
  );
}
