import type { ApiDto } from "@nextdrop/contracts";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { CapacityBar } from "../../ui";
import { formatDay } from "../../lib/time";
import type { DraftData, Outlet, Vehicle } from "./planning";

interface Props {
  day: ApiDto<"dayResponse">;
  data: DraftData;
  vehicles: readonly Vehicle[];
  outlets: readonly Outlet[];
  workshop: readonly Vehicle[];
  runs: ApiDto<"runsResponse"> | null;
  exceptions: ApiDto<"exceptionsResponse"> | null;
}
export function Dashboard({ day, data, vehicles, outlets, workshop, runs, exceptions }: Props) {
  const { t } = useTranslation("dispatcher/planning");
  const available = vehicles.filter((v) => !workshop.some((w) => w.id === v.id));
  const weight = day.queue.reduce((n, o) => n + o.weightG, 0) / 1000;
  const chilled = day.queue.filter((o) => o.tempRequirement === "chilled").reduce((n, o) => n + o.volumeL, 0) / 1000;
  const statusCount = (status: string) =>
    runs
      ? runs.items
          .flatMap((r) => r.trips)
          .flatMap((trip) => trip.stops)
          .filter((s) => s.order.currentDate === day.date && s.order.status === status).length
      : t("unavailable");
  const tiles = [
    ["confirmed", day.queue.length],
    ["planned", data.trips.reduce((n, trip) => n + trip.orderIds.length, 0)],
    [
      "deferred",
      new Set([
        ...data.deferrals.map((item) => item.orderId),
        ...day.queue.filter((order) => order.status === "DEFERRED").map((order) => order.id),
      ]).size,
    ],
    ["outForDelivery", statusCount("OUT_FOR_DELIVERY")],
    ["delivered", statusCount("DELIVERED")],
    ["received", statusCount("RECEIVED")],
  ] as const;
  return (
    <>
      <div className="dispatch-kpis">
        {tiles.map(([key, value]) => (
          <Link
            to={
              key === "confirmed"
                ? "/dispatch/queue"
                : key === "planned"
                  ? "/dispatch/plan"
                  : key === "deferred"
                    ? "/dispatch/defer"
                    : "/dispatch/runs"
            }
            className="dispatch-card"
            key={key}
          >
            <span>{t(key)}</span>
            <strong>{value}</strong>
            <small>{t("planningFor", { date: formatDay(`${day.date}T12:00:00+05:30`), depot: day.depot })}</small>
          </Link>
        ))}
      </div>
      <div className="dispatch-capacity-grid">
        <section className="dispatch-card">
          <CapacityBar
            label={t("weightFleet")}
            used={weight}
            capacity={available.reduce((n, v) => n + v.weightCapG, 0) / 1000}
            unit={t("units.kg")}
            tone="ok"
          />
        </section>
        <section className="dispatch-card">
          <CapacityBar
            label={t("chilledCapacity")}
            used={chilled}
            capacity={available.filter((v) => v.temp === "reefer").reduce((n, v) => n + v.volumeCapL, 0) / 1000}
            unit={t("units.m3")}
          />
        </section>
        <section className="dispatch-card">
          <h3>{t("tripsPerVehicle")}</h3>
          <strong>
            {t("vehicleTripCount", {
              vehicles: new Set(data.trips.map((trip) => trip.vehicleId)).size,
              trips: data.trips.length,
            })}
          </strong>
        </section>
      </div>
      <div className="dispatch-dashboard-grid">
        <section className="dispatch-card">
          <header className="dispatch-card-heading">
            <h2>{t("tripsHeading", { date: formatDay(`${day.date}T12:00:00+05:30`) })}</h2>
            <Link to="/dispatch/plan">{t("openPlan")} ›</Link>
          </header>
          <div className="dispatch-table-scroll">
            <table>
              <thead>
                <tr>
                  {["trip", "vehicle", "brand", "stops", "load"].map((key) => (
                    <th key={key}>{t(key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.trips.map((trip) => {
                  const vehicle = vehicles.find((v) => v.id === trip.vehicleId);
                  const orders = day.queue.filter((o) => trip.orderIds.includes(o.id));
                  const outlet = outlets.find((o) => o.id === orders[0]?.outletId);
                  return (
                    <tr key={trip.ref}>
                      <td>
                        <Link to={`/dispatch/plan?trip=${encodeURIComponent(trip.ref)}`}>{trip.ref}</Link>
                      </td>
                      <td>
                        {vehicle?.displayId ?? t("unavailable")}
                        <small>{t("tripNumber", { number: trip.tripNo, max: 2 })}</small>
                      </td>
                      <td>
                        {outlet ? t(`brands.${outlet.brand}`) : t("unavailable")}
                        <small>{outlet?.district}</small>
                      </td>
                      <td>{orders.length}</td>
                      <td>
                        {Intl.NumberFormat().format(orders.reduce((n, o) => n + o.weightG, 0) / 1000)} {t("units.kg")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!data.trips.length && <p className="dispatch-muted">{t("noTrips")}</p>}
        </section>
        <section className="dispatch-card">
          <h2>{t("attention")}</h2>
          <ul className="dispatch-attention">
            {data.unassignedOrderIds.length > 0 && (
              <li>
                <Link to="/dispatch/plan">{t("unassignedAttention", { count: data.unassignedOrderIds.length })} ›</Link>
              </li>
            )}
            {workshop.map((v) => (
              <li key={v.id}>
                <Link to={`/dispatch/fleet?vehicle=${encodeURIComponent(v.id)}`}>
                  {t("workshop", { vehicle: v.displayId })}
                </Link>
                <small>{t("workshopDetail")}</small>
              </li>
            ))}
            {exceptions === null ? (
              <li>{t("unavailable")}</li>
            ) : exceptions.items.length > 0 ? (
              <li>
                <Link to="/dispatch/runs">{t("exceptions", { count: exceptions.items.length })} ›</Link>
              </li>
            ) : null}
          </ul>
        </section>
      </div>
    </>
  );
}
