import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { useSession } from "../../lib/session";
import { fieldRepository } from "../../sync";
import { Banner, HoldToConfirm } from "../../ui";
import { tripGate, orderGate, loadTotals } from "./model";
import { Frame, TripSummary, Back, Empty, ReceiptStatus } from "./parts";
import { PlanReview } from "./Review";
import type { LoaderData } from "./data";
import { queueReady } from "./drafts";
export function Ready({ data }: { data: LoaderData }) {
  const { t } = useTranslation("loader/dock");
  const { user } = useSession();
  const { tripId } = useParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const snapshot = data.snapshot;
  const trip = snapshot?.scope.trips.find((trip) => trip.id === tripId);
  if (!snapshot || !trip || !trip.stops.every((s) => data.states[s.order.id]))
    return (
      <Frame data={data}>
        <Empty data={data} />
        <Back to="/loader" label={t("trips")} />
      </Frame>
    );
  const gate = tripGate(trip, data.states);
  const totals = loadTotals(trip, data.states);
  const checked = trip.stops.filter((s) => !orderGate(s, data.states[s.order.id]!).incompleteLines.length).length;
  const record = data.receipts.find((r) => r.kind === "TRIP_READY" && r.tripId === trip.id);
  const drafts = data.drafts.some((d) => d.receipt.tripId === trip.id);
  const ready = gate.ready && !drafts && !record && trip.stops.length > 0 && trip.status === "PLANNED";
  const markReady = async () => {
    if (!ready || busy || snapshot.planVersion === null) return;
    setBusy(true);
    setError(false);
    try {
      await queueReady(fieldRepository, user.id, snapshot, trip.id);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Frame
      data={data}
      footer={
        record ? (
          <ReceiptStatus receipt={record} data={data} />
        ) : (
          <HoldToConfirm disabled={!ready || busy} onConfirm={() => void markReady()}>
            {t("holdReady")}
          </HoldToConfirm>
        )
      }
    >
      <PlanReview data={data} />
      <div className="loader-heading">
        <Back to={`/loader/trips/${trip.id}`} label={t("checklist")} />
        <div>
          <h1>{t("markReady", { trip: trip.displayId })}</h1>
          <p className="loader-muted">{t("readyInstruction")}</p>
        </div>
      </div>
      {error && <Banner tone="warn" message={t("saveError")} />}
      <div className="loader-ready">
        <div>
          <h2>{t("checkedCount", { count: checked, total: trip.stops.length })}</h2>
          <TripSummary trip={trip} data={data} />
        </div>
        <section className="loader-card">
          <h2>{t("issues")}</h2>
          <p>{t("summaryUnits", totals)}</p>
          {trip.stops.map((stop) => {
            const state = data.states[stop.order.id]!;
            return state.short.length || state.damaged.length ? (
              <article className="loader-issue" key={stop.id}>
                <h3>
                  {stop.outlet.displayId} · {stop.outlet.name}
                </h3>
                {state.short.map((line, index) => (
                  <p key={`short:${index}`} className="loader-waiting">
                    {stop.order.lines.find((l) => l.id === line.lineId)?.name} ·{" "}
                    {t("shortUnits", { count: line.qtyShort })} ·{" "}
                    {t(line.resolution ? `resolution.${line.resolution}` : "waitingDispatch")}
                  </p>
                ))}
                {state.damaged.map((line, index) => (
                  <p key={`damage:${index}`}>
                    {stop.order.lines.find((l) => l.id === line.lineId)?.name} ·{" "}
                    {t("damagedUnits", { count: line.qty })}
                  </p>
                ))}
              </article>
            ) : null;
          })}
          {!!gate.incompleteLines.length && (
            <Banner tone="warn" message={t("uncheckedLines", { count: gate.incompleteLines.length })} />
          )}
          {!!gate.blockingShorts.length && <Banner tone="warn" message={t("waitingDispatch")} />}
          {drafts && <Banner tone="info" message={t("undoWindow")} />}
          {["READY", "DEPARTED", "COMPLETE"].includes(trip.status) && <Banner tone="ok" message={t("handedOver")} />}
        </section>
      </div>
    </Frame>
  );
}
