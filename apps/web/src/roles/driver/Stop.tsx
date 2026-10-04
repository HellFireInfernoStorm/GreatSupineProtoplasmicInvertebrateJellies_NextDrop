import { Pill } from "../../ui/StatusPill";
import { useRef, useState, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import type { TripDto } from "@nextdrop/contracts";
import { formatTime } from "../../lib/time";
import { useSession } from "../../lib/session";
import { useSyncActivity } from "../../sync/controller";
import { fieldRepository, queuePhoto } from "../../sync";
import { Button, Banner, FormField, QuantityStepper, Sheet } from "../../ui";
import { useDriverData } from "./data";
import {
  groupStops,
  deliveryIntents,
  deliveryKey,
  projected,
  saveDelivery,
  savedDeliveryCount,
  receiptEvents,
  capturedTime,
  type Stop,
} from "./model";
import { Frame, Action, Icon, Maps } from "./parts";

function Signature({
  canvas,
  onSigned,
}: {
  canvas: React.RefObject<HTMLCanvasElement | null>;
  onSigned: (value: boolean) => void;
}) {
  const { t } = useTranslation("driver/run");
  const drawing = useRef(false);
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) * event.currentTarget.width) / rect.width,
      ((event.clientY - rect.top) * event.currentTarget.height) / rect.height,
    ] as const;
  };
  return (
    <div className="driver-signature">
      <Button
        variant="ghost"
        onClick={() => {
          canvas.current?.getContext("2d")?.clearRect(0, 0, 656, 384);
          onSigned(false);
        }}
        icon={<Icon name="undo" />}
      >
        {t("clear")}
      </Button>
      <canvas
        ref={canvas}
        width={656}
        height={384}
        aria-label={t("signHere")}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = true;
          const c = event.currentTarget.getContext("2d")!;
          c.beginPath();
          c.moveTo(...point(event));
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const c = event.currentTarget.getContext("2d")!;
          c.lineWidth = 4;
          c.lineCap = "round";
          c.strokeStyle = getComputedStyle(event.currentTarget).color;
          c.lineTo(...point(event));
          c.stroke();
          onSigned(true);
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
      <p className="driver-muted">{t("signHere")}</p>
    </div>
  );
}
export function StopPage() {
  const { stopId } = useParams();
  const data = useDriverData();
  const { t } = useTranslation("driver/run");
  const trip = data.snapshot?.scope.trips.find((trip) => trip.stops.some((s) => s.id === stopId));
  const stop = trip?.stops.find((s) => s.id === stopId);
  if (!stop || !trip || !data.snapshot)
    return (
      <Frame back title={t("stop")}>
        <Banner tone="warn" message={t(data.loaded ? "stopUnavailable" : "loading")} />
      </Frame>
    );
  const number =
    groupStops(data.snapshot.scope.trips).findIndex((group) => group.stops.some((s) => s.id === stop.id)) + 1;
  return (
    <StopForm number={number} key={`${stop.id}:${data.snapshot.planVersion}`} stop={stop} trip={trip} data={data} />
  );
}
function StopForm({
  stop,
  trip,
  data,
  number,
}: {
  stop: Stop;
  trip: TripDto;
  data: ReturnType<typeof useDriverData>;
  number: number;
}) {
  const { t } = useTranslation("driver/run");
  const { user } = useSession();
  const navigate = useNavigate();
  const snapshot = data.snapshot!;
  const activity = useSyncActivity();
  const receipt = data.receipts.find((r) => r.kind === "DELIVERY" && r.orderId === stop.order.id);
  const arrived =
    !!stop.arrivedAt ||
    data.events.some((e) => e.type === "STOP_ARRIVED" && e.subject.orderId === stop.order.id && projected(e));
  const [step, setStep] = useState(receipt ? "saved" : arrived ? "outcome" : "arriving");
  const [outcome, setOutcome] = useState<"FULL" | "PARTIAL" | "REFUSED" | "FAILED">("FULL");
  const [quantities, setQuantities] = useState<Record<string, number>>(
    Object.fromEntries(stop.order.lines.map((l) => [l.id, l.qtyLoaded])),
  );
  const [reason, setReason] = useState("");
  const [receiver, setReceiver] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [flagSaved, setFlagSaved] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagNote, setFlagNote] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const departed =
    trip.status === "DEPARTED" ||
    trip.status === "COMPLETE" ||
    data.events.some((e) => e.type === "TRIP_DEPARTED" && e.payload.tripId === trip.id && projected(e));
  const savedCount = savedDeliveryCount(data.receipts, data.events);
  const savedEvents = receipt ? receiptEvents(receipt, data.events) : [];
  const savedOutcome = savedEvents.find((e) => e.type === "STOP_OUTCOME");
  const proofRefs = savedEvents.flatMap((e) => e.blobRefs);
  const pendingProof = data.blobs.filter((b) => proofRefs.includes(b.clientBlobId) && b.state !== "acked");
  const proofConfirmed =
    pendingProof.length === 0 &&
    proofRefs.every((ref) => data.blobs.some((b) => b.clientBlobId === ref && b.state === "acked"));
  const fullyConfirmed =
    proofConfirmed &&
    savedEvents.length > 0 &&
    savedEvents.every(
      (e) =>
        e.state === "acked" &&
        e.confirmationFeedHead !== undefined &&
        BigInt(e.confirmationFeedHead) <= BigInt(snapshot.feedCursor),
    );
  const savedIssue =
    savedEvents.some((e) => e.state === "rejected" || e.state === "failed") ||
    pendingProof.some((b) => b.state === "failed");
  const savedHeld = savedEvents.some((e) => e.state === "held");
  const queuedCount =
    savedEvents.filter((e) => e.state === "pending" || e.state === "sending").length + pendingProof.length;
  const savedState = savedIssue
    ? "needsAttention"
    : savedHeld
      ? "needsDispatch"
      : fullyConfirmed
        ? "allSynced"
        : activity.offline
          ? "waitingSignal"
          : queuedCount
            ? activity.syncing
              ? "syncing"
              : "waiting"
            : "waitingSnapshot";
  const photo = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(false);
    try {
      const id = await queuePhoto(file, user.id);
      setPhotos((p) => [...p, id]);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await fn();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const arrivedAction = () =>
    act(async () => {
      if (!departed) throw new Error("Start the run first");
      await fieldRepository.enqueue({
        type: "STOP_ARRIVED",
        subject: { orderId: stop.order.id, tripId: trip.id, vehicleId: trip.vehicleId },
        actor: { userId: user.id, role: "DRIVER" },
        payload: { orderId: stop.order.id },
      });
      setStep("outcome");
    });
  const save = () =>
    act(async () => {
      let signature: string | undefined;
      if (signed && canvas.current) {
        const image = document.createElement("canvas");
        image.width = canvas.current.width;
        image.height = canvas.current.height;
        const c = image.getContext("2d")!;
        c.fillStyle = getComputedStyle(canvas.current).backgroundColor;
        c.fillRect(0, 0, image.width, image.height);
        c.drawImage(canvas.current, 0, 0);
        const bytes = await new Promise<Blob | null>((resolve) => image.toBlob(resolve, "image/png"));
        if (!bytes) throw new Error("Signature encoding failed");
        signature = await queuePhoto(bytes, user.id);
      }
      const intents = deliveryIntents({
        stop,
        trip,
        userId: user.id,
        outcome,
        quantities,
        reason,
        receiver,
        photos,
        signature,
      });
      await saveDelivery(
        fieldRepository,
        {
          id: deliveryKey(user.id, snapshot.resetEpoch, snapshot.scope.date, stop.order.id),
          userId: user.id,
          resetEpoch: snapshot.resetEpoch,
          date: snapshot.scope.date,
          tripId: trip.id,
          orderId: stop.order.id,
          kind: "DELIVERY",
          planVersion: snapshot.planVersion!,
        },
        intents,
      );
      setStep("saved");
    });
  const selectedPartialValid =
    outcome !== "PARTIAL" ||
    (stop.order.lines.some((l) => (quantities[l.id] ?? 0) > 0) &&
      stop.order.lines.some((l) => (quantities[l.id] ?? 0) < l.qtyLoaded));
  const terminal = ["DELIVERED", "FAILED", "CONFIRMED", "DISPUTED"].includes(stop.order.status) && !receipt;
  return (
    <Frame
      back
      title={step === "proof" ? t("proofTitle", { number }) : t("stopTitle", { number, outlet: stop.outlet.displayId })}
      savedCount={savedCount}
      footer={
        terminal ? undefined : step === "arriving" ? (
          <Action loading={busy} disabled={!departed} onClick={() => void arrivedAction()}>
            {t("arrived")}
          </Action>
        ) : step === "proof" ? (
          <Action
            loading={busy}
            disabled={
              !receiver.trim() ||
              (!signed && !photos.length) ||
              (outcome !== "FULL" && (!reason || !photos.length)) ||
              !selectedPartialValid
            }
            onClick={() => void save()}
          >
            {t("saveDelivery")}
          </Action>
        ) : step === "saved" ? (
          <Action onClick={() => void navigate("/driver")}>{t("continueRun")}</Action>
        ) : undefined
      }
    >
      {error && <Banner tone="warn" message={t("saveError")} />}
      {!departed && !terminal && <Banner tone="info" message={t("startFirst")} />}
      {flagSaved && <Banner tone="info" message={t("flagSaved")} />}
      {terminal ? (
        <Banner tone="ok" message={t("alreadyRecorded")} />
      ) : step === "saved" ? (
        <>
          <div className="driver-saved-icon">
            <Icon name="saved" />
          </div>
          <h2 className="driver-saved-heading">{t("savedTitle")}</h2>
          {savedOutcome && (
            <p className="driver-muted driver-saved-caption">
              {stop.order.displayId} · {stop.outlet.displayId} · {formatTime(capturedTime(savedOutcome))}
            </p>
          )}
          <section className="driver-card driver-saved-status">
            <div>
              <Icon name="check" />
              <div>
                <strong>{t("savedTitle")}</strong>
                {savedOutcome && <p className="driver-muted">{formatTime(capturedTime(savedOutcome))}</p>}
              </div>
            </div>
            <div>
              <Icon name="clock" />
              <div>
                <strong>{t(savedState, { count: queuedCount })}</strong>
                <p className="driver-muted">
                  {t(fullyConfirmed ? "confirmedAll" : savedIssue || savedHeld ? "proofKept" : "savedDetail")}
                </p>
              </div>
            </div>
          </section>
          <p className="driver-muted">{t("proofKept")}</p>
        </>
      ) : step === "arriving" ? (
        <>
          <section className="driver-card">
            <h2>{stop.outlet.displayId}</h2>
            <p className="driver-muted">
              {stop.outlet.name} · {stop.outlet.district}
            </p>
            <div className="driver-chips">
              <Pill tone="neutral">{t(`dock.${stop.outlet.dockType}`)}</Pill>
              {stop.order.tempRequirement === "chilled" && (
                <Pill tone="chilled" icon={<Icon name="chilled" />}>
                  {t("chilled")}
                </Pill>
              )}
            </div>
          </section>
          <section className="driver-card">
            <p>{stop.outlet.address ?? stop.outlet.name}</p>
            <p className="driver-muted">{t(`parking.${stop.outlet.parking}`)}</p>
            {stop.outlet.contact && (
              <p>
                {stop.outlet.contact.name}
                {stop.outlet.contact.phone && (
                  <>
                    {" "}
                    · <a href={`tel:${stop.outlet.contact.phone}`}>{stop.outlet.contact.phone}</a>
                  </>
                )}
              </p>
            )}
          </section>
          <section className="driver-card">
            <div className="driver-row">
              <h2>{t("itemsOnBoard")}</h2>
              <span className="driver-muted">{stop.order.displayId}</span>
            </div>
            {stop.order.lines.map((l) => (
              <p key={l.id}>
                {l.qtyLoaded} {l.unitLabel} · {l.name}
              </p>
            ))}
          </section>
          {stop.order.flags.short.length > 0 && (
            <Banner
              tone="warn"
              message={t("loadedShort")}
              detail={stop.order.flags.short.map((l) => `${l.qtyShort}`).join(", ")}
            />
          )}
          <div className="driver-row">
            <Maps stop={stop} />
            <Button variant="secondary" icon={<Icon name="flag" />} onClick={() => setFlagOpen(true)}>
              {t("flagProblem")}
            </Button>
          </div>
        </>
      ) : step === "outcome" ? (
        <>
          <h2 className="driver-headline">{t("howDidItGo")}</h2>
          {(["FULL", "PARTIAL", "REFUSED", "FAILED"] as const).map((choice) => (
            <button
              key={choice}
              className="driver-card driver-choice"
              onClick={() => {
                setOutcome(choice);
                setStep("proof");
              }}
            >
              <Icon name={choice === "FULL" ? "full" : choice === "PARTIAL" ? "partial" : "refused"} />
              <span>
                <strong>{t(`outcome.${choice}`)}</strong>
                <small>{t(`outcomeHelp.${choice}`)}</small>
              </span>
              <Icon name="next" />
            </button>
          ))}
          <p className="driver-muted">{t("nonFullHelp")}</p>
        </>
      ) : (
        <>
          <Banner tone={outcome === "FULL" ? "ok" : "warn"} message={t(`outcome.${outcome}`)} />
          {outcome === "PARTIAL" &&
            stop.order.lines.map((line) => (
              <QuantityStepper
                key={line.id}
                label={line.name}
                value={quantities[line.id] ?? 0}
                min={0}
                max={line.qtyLoaded}
                onChange={(qty) => setQuantities((q) => ({ ...q, [line.id]: qty }))}
              />
            ))}
          {outcome !== "FULL" && (
            <FormField id="delivery-reason" label={t("reasonLabel")} required>
              <select value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">{t("chooseReason")}</option>
                {snapshot.config.reasons.stopOutcome.map((r) => (
                  <option key={r.code} value={r.code}>
                    {t(`reason.${r.code}`, { defaultValue: r.code })}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          <FormField id="receiver" label={t("receivedBy")} required>
            <input autoComplete="name" value={receiver} onChange={(e) => setReceiver(e.target.value)} />
          </FormField>
          <h2>{t("signatureOrPhoto")}</h2>
          <Signature canvas={canvas} onSigned={setSigned} />
          <FormField id="proof-photo" label={t(outcome === "FULL" ? "photoOptional" : "photoRequired")}>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              disabled={busy}
              onChange={(e) => void photo(e.target.files?.[0])}
            />
          </FormField>
          {!!photos.length && <Pill tone="ok">{t("photosSaved", { count: photos.length })}</Pill>}
          <Button
            variant="ghost"
            onClick={() => {
              setSigned(false);
              setStep("outcome");
            }}
          >
            {t("changeOutcome")}
          </Button>
        </>
      )}
      <Sheet open={flagOpen} onClose={() => setFlagOpen(false)} title={t("flagProblem")}>
        {error && <Banner tone="warn" message={t("saveError")} />}
        <FormField id="flag-note" label={t("note")}>
          <textarea value={flagNote} onChange={(e) => setFlagNote(e.target.value)} />
        </FormField>
        {snapshot.config.reasons.problems.map((r) => (
          <Button
            key={r.code}
            disabled={busy}
            variant="secondary"
            onClick={() =>
              void act(async () => {
                await fieldRepository.enqueue({
                  type: "PROBLEM_FLAGGED",
                  subject: { orderId: stop.order.id, tripId: trip.id, vehicleId: trip.vehicleId },
                  actor: { userId: user.id, role: "DRIVER" },
                  payload: { kind: r.code, ...(flagNote.trim() ? { note: flagNote.trim() } : {}) },
                });
                setFlagSaved(true);
                setFlagOpen(false);
              })
            }
          >
            {t(`problem.${r.code}`)}
          </Button>
        ))}
      </Sheet>
    </Frame>
  );
}
