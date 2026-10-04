import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Pill } from "../../ui/StatusPill";
import { TRIP_TONES } from "../../ui/status";
import type { LoaderData } from "./data";
import { Frame, Empty, Countdown } from "./parts";
import { PlanReview } from "./Review";
import { orderGate } from "./model";
import { formatTime } from "../../lib/time";
import { Reversals } from "./Reversals";
export function Dock({ data }: { data: LoaderData }) {
  const { t } = useTranslation("loader/dock");
  const snapshot = data.snapshot;
  const trips = [...(snapshot?.scope.trips ?? [])].sort(
    (a, b) => Date.parse(a.plannedDepart) - Date.parse(b.plannedDepart),
  );
  return (
    <Frame data={data}>
      <PlanReview data={data} />
      <Reversals data={data} />
      <div className="loader-heading">
        <h1>{t("title")}</h1>
        {trips.length > 0 && <p className="loader-muted">{t("earliestFirst", { count: trips.length })}</p>}
      </div>
      {!snapshot ? (
        <Empty data={data} />
      ) : snapshot.planVersion === null ? (
        <p>{t("planNotPublished")}</p>
      ) : !trips.length ? (
        <p>{t("noTrips")}</p>
      ) : (
        trips.map((trip) => {
          const checked = trip.stops.filter(
            (s) => data.states[s.order.id] && !orderGate(s, data.states[s.order.id]!).incompleteLines.length,
          ).length;
          const blocked = trip.stops.some(
            (s) => data.states[s.order.id] && orderGate(s, data.states[s.order.id]!).blockingShorts.length,
          );
          return (
            <section key={trip.id} className="loader-card loader-trip">
              <div>
                <strong className="loader-departure">{formatTime(trip.plannedDepart)}</strong>
                <Countdown departure={trip.plannedDepart} />
              </div>
              <div>
                <h2>
                  {trip.displayId} · {t("tripNumber", { number: trip.tripNo })}
                </h2>
                <p className="loader-muted">
                  {trip.brand} · {trip.district} · {t("stops", { count: trip.stops.length })}
                </p>
              </div>
              <div className="loader-progress">
                <span>{t("checkedCount", { count: checked, total: trip.stops.length })}</span>
                <progress aria-label={t("checked")} max={Math.max(1, trip.stops.length)} value={checked} />
              </div>
              <div>
                <Pill tone={TRIP_TONES[trip.status]}>{t(`tripStatus.${trip.status}`, { ns: "shared/ui" })}</Pill>
                {blocked && <p className="loader-waiting">{t("waitingDispatch")}</p>}
              </div>
              <Link className="loader-back" to={`/loader/trips/${trip.id}`}>
                {t("open")}
              </Link>
            </section>
          );
        })
      )}
    </Frame>
  );
}
