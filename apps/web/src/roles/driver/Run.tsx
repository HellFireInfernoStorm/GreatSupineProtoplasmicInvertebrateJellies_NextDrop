import { Pill } from "../../ui/StatusPill";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { useSession } from "../../lib/session";
import { formatTime } from "../../lib/time";
import { fieldRepository } from "../../sync";
import { Banner } from "../../ui";
import { useDriverData } from "./data";
import { groupStops, deliveryDone, savedDeliveryCount, projected, receiptEvents, capturedTime } from "./model";
import { Frame, Action, Icon, Maps } from "./parts";
import { PlanReview } from "./Sync";
export function Run() {
  const { t } = useTranslation("driver/run");
  const { user } = useSession();
  const data = useDriverData();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const snapshot = data.snapshot?.role === "DRIVER" ? data.snapshot : null;
  const groups = groupStops(snapshot?.scope.trips ?? []);
  const receipt = (orderId: string) => data.receipts.find((r) => r.kind === "DELIVERY" && r.orderId === orderId);
  const done = (group: (typeof groups)[number]) =>
    group.stops.every((s) => deliveryDone(s, receipt(s.order.id), data.events));
  const next = groups.find((g) => !done(g));
  const nextStop = next?.stops.find((s) => !deliveryDone(s, receipt(s.order.id), data.events));
  const departed =
    !!next &&
    (next.trip.status === "DEPARTED" ||
      next.trip.status === "COMPLETE" ||
      data.events.some((e) => e.type === "TRIP_DEPARTED" && e.payload.tripId === next.trip.id && projected(e)));
  const start = async () => {
    if (!next || busy) return;
    setBusy(true);
    setError(false);
    try {
      await fieldRepository.enqueue({
        type: "TRIP_DEPARTED",
        subject: { tripId: next.trip.id, vehicleId: next.trip.vehicleId },
        actor: { userId: user.id, role: "DRIVER" },
        payload: { tripId: next.trip.id },
      });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const savedCount = savedDeliveryCount(data.receipts, data.events);
  return (
    <Frame
      title={t("title")}
      savedCount={savedCount}
      footer={
        nextStop ? (
          <Action
            loading={busy}
            onClick={() => {
              if (departed) void navigate(`/driver/stop/${nextStop.id}`);
              else void start();
            }}
          >
            {departed ? t("goToStop", { number: groups.indexOf(next!) + 1 }) : t("startRun")}
            {departed && <Icon name="next" />}
          </Action>
        ) : undefined
      }
    >
      {error && <Banner tone="warn" message={t("saveError")} />}
      {!snapshot ? (
        <p>{t(data.loaded ? "noRun" : "loading")}</p>
      ) : (
        <>
          <section className="driver-card driver-run-summary">
            <div className="driver-row">
              <h2>
                {snapshot.scope.vehicle.displayId} · {t(`vehicle.${snapshot.scope.vehicle.type}`)}
              </h2>
              {snapshot.scope.vehicle.temp === "reefer" && (
                <Pill tone="chilled" icon={<Icon name="chilled" />}>
                  {t("reefer")}
                </Pill>
              )}
            </div>
            <p className="driver-muted">
              {next
                ? t("trip", {
                    trip: next.trip.displayId,
                    brand: next.trip.brand,
                    depot: snapshot.scope.vehicle.depot,
                    time: formatTime(next.trip.plannedDepart),
                  })
                : t("runComplete")}
            </p>
            <div className="driver-row">
              <strong className="driver-number">
                {groups.filter(done).length}/{groups.length}
              </strong>
              <span className="driver-muted">{t("stopsDone")}</span>
            </div>
            <div className="driver-segments" aria-label={t("stopsDone")}>
              {groups.map((g) => (
                <span key={g.stops[0]!.id} data-done={done(g)} data-next={g === next} />
              ))}
            </div>
          </section>
          {groups.map((group, index) => {
            const stop = group.stops[0]!;
            return (
              <section key={stop.id} className={`driver-card driver-stop-card ${group === next ? "driver-next" : ""}`}>
                <Link
                  className="driver-stop-title"
                  to={`/driver/stop/${group.stops.find((s) => !deliveryDone(s, receipt(s.order.id), data.events))?.id ?? stop.id}`}
                >
                  <span className="driver-marker" data-done={done(group)}>
                    {done(group) ? <Icon name="check" /> : index + 1}
                  </span>
                  <div>
                    {group === next && <p className="driver-eyebrow">{t("nextStop")}</p>}
                    <h2>
                      {stop.outlet.displayId} · {stop.outlet.district}
                    </h2>
                  </div>
                </Link>
                {group === next ? (
                  <>
                    <div className="driver-chips">
                      <Pill tone="neutral" icon={<Icon name="clock" />}>
                        {formatTime(stop.etaFrom)}–{formatTime(stop.etaTo)}
                      </Pill>
                      <Pill tone="neutral" icon={<Icon name="dock" />}>
                        {t(`dock.${stop.outlet.dockType}`)}
                      </Pill>
                      {group.stops.some((s) => s.order.tempRequirement === "chilled") && (
                        <Pill tone="chilled" icon={<Icon name="chilled" />}>
                          {t("chilled")}
                        </Pill>
                      )}
                    </div>
                    <p className="driver-muted">{stop.outlet.address ?? stop.outlet.name}</p>
                    <Maps stop={stop} />
                  </>
                ) : (
                  <p className="driver-muted">
                    {done(group)
                      ? t("completed")
                      : `${formatTime(stop.etaFrom)}–${formatTime(stop.etaTo)} · ${t(`dock.${stop.outlet.dockType}`)}`}
                  </p>
                )}
                {group.stops.length > 1 && (
                  <details className="driver-orders">
                    <summary>{t("groupedOrders", { count: group.stops.length })}</summary>
                    {group.stops.map((s) => (
                      <Link key={s.id} to={`/driver/stop/${s.id}`}>
                        {s.order.displayId} ·{" "}
                        {t(deliveryDone(s, receipt(s.order.id), data.events) ? "completed" : "stop")}
                      </Link>
                    ))}
                  </details>
                )}
                {group.stops.map((s) => {
                  const record = receipt(s.order.id);
                  const outcome = record
                    ? receiptEvents(record, data.events).find((e) => e.type === "STOP_OUTCOME")
                    : undefined;
                  const capture = s.deliveredAt ?? (outcome ? capturedTime(outcome) : null);
                  const confirmation = s.confirmedAt ?? outcome?.confirmedAt;
                  return capture ? (
                    <p key={s.id} className="driver-muted">
                      {s.order.displayId} ·{" "}
                      {confirmation
                        ? t("twoTimes", { captured: formatTime(capture), confirmed: formatTime(confirmation) })
                        : t("capturedOnly", { time: formatTime(capture) })}
                    </p>
                  ) : null;
                })}
              </section>
            );
          })}
          {!groups.length && <p>{t("noStops")}</p>}
        </>
      )}
      <PlanReview data={data} />
    </Frame>
  );
}
