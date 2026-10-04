import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { runUsage, type ValidationContext } from "@nextdrop/rules";
import { Button, CapacityBar, ChilledPill } from "../../ui";
import { Pill } from "../../ui/StatusPill";
import {
  moveOrder,
  evaluate,
  lockedDraftChange,
  type DraftData,
  type Order,
  type Outlet,
  type Vehicle,
  type BrowserReference,
} from "./planning";
import { ValidationChecks } from "./ValidationChecks";
import { AddTrip } from "./AddTrip";

interface Props {
  data: DraftData;
  orders: readonly Order[];
  outlets: readonly Outlet[];
  vehicles: readonly Vehicle[];
  reference: BrowserReference;
  context: ValidationContext;
  unavailable: ReadonlySet<string>;
  date: string;
  disabled: boolean;
  busy: boolean;
  onSave: (data: DraftData) => Promise<boolean>;
  onEditingChange: (editing: boolean) => void;
}
export function PlanBoard({
  data,
  orders,
  outlets,
  vehicles,
  reference,
  context,
  unavailable,
  date,
  disabled,
  busy,
  onSave,
  onEditingChange,
}: Props) {
  const { t } = useTranslation("dispatcher/planning");
  const [addOpen, setAddOpen] = useState(false);
  const [preview, setPreview] = useState<DraftData | null>(null);
  const result = evaluate(preview ?? data, orders, date, reference, unavailable, context);
  const savedResult = evaluate(data, orders, date, reference, unavailable, context);
  const usages = new Map(
    [...new Set(savedResult.plan.trips.map((trip) => trip.vehicleId))].flatMap((vehicleId) => {
      const vehicle = reference.ref.vehicles.get(vehicleId);
      return vehicle ? [[vehicleId, runUsage(savedResult.plan.trips, vehicle, reference.ref, context)] as const] : [];
    }),
  );
  const minutes = (value: number) =>
    `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  const orderCard = (order: Order, seq?: number) => {
    const outlet = outlets.find((out) => out.id === order.outletId);
    const locked = context.publishedStops?.some((s) => s.orderId === order.id && s.locked) ?? false;
    const allowed = (destination: string | null) =>
      lockedDraftChange(moveOrder(data, order.id, destination), reference, context) === null;
    return (
      <div className="dispatch-order-card" key={order.id}>
        <strong>
          {seq === undefined ? order.displayId : `${seq} · ${outlet?.displayId ?? order.displayId}`} {outlet?.name}
        </strong>
        <small>
          {order.weightG / 1000} {t("units.kg")}
        </small>
        <span className="dispatch-flags">
          {locked && <Pill tone="warn">{t("stopLocked")}</Pill>}
          {order.tempRequirement === "chilled" && <ChilledPill />}
          {outlet?.parking === "van_only" && <Pill tone="deferred">{t("vanOnly")}</Pill>}
          {order.deferredCount > 0 && <Pill tone="warn">{t("previouslyDeferred")}</Pill>}
          {context.deferredLastRunOutletIds?.has(reference.outletDisplay.get(order.outletId) ?? order.outletId) && (
            <Pill tone="warn">{t("skippedPrevious")}</Pill>
          )}
        </span>
        <select
          aria-label={`${t("moveTo")} ${order.displayId}`}
          disabled={disabled || busy || locked}
          value=""
          onChange={(e) => {
            if (e.target.value) {
              onEditingChange(true);
              setPreview(moveOrder(data, order.id, e.target.value === "unassigned" ? null : e.target.value));
            }
          }}
        >
          <option value="">{t("moveTo")}</option>
          {data.trips
            .filter((trip) => allowed(trip.ref))
            .map((trip) => (
              <option key={trip.ref} value={trip.ref}>
                {trip.ref} · {vehicles.find((v) => v.id === trip.vehicleId)?.displayId}
              </option>
            ))}
          {allowed(null) && <option value="unassigned">{t("unassigned")}</option>}
        </select>
      </div>
    );
  };
  return (
    <>
      <div className="dispatch-plan-summary">
        {t("summary", {
          trips: data.trips.length,
          planned: data.trips.reduce((n, trip) => n + trip.orderIds.length, 0),
          orders: orders.length,
          unassigned: data.unassignedOrderIds.length,
        })}
        <div className="dispatch-actions">
          <Button
            variant="secondary"
            disabled={disabled || busy || preview !== null}
            onClick={() => {
              onEditingChange(true);
              setAddOpen(true);
            }}
          >
            {t("addTrip")}
          </Button>
          <Link className="dispatch-primary-link" to="/dispatch/defer">
            {t("reviewPublish")} ›
          </Link>
        </div>
      </div>
      <div className="dispatch-plan-layout">
        <div className="dispatch-trip-grid">
          {data.trips.map((trip) => {
            const vehicle = vehicles.find((v) => v.id === trip.vehicleId);
            const rulesTrip = savedResult.plan.trips.find((p) => p.ref === trip.ref);
            const usage = rulesTrip ? usages.get(rulesTrip.vehicleId) : undefined;
            const schedule = usage?.schedules.find((s) => s.trip.ref === trip.ref);
            const assigned = (schedule ? schedule.stops.map((stop) => stop.orderId) : trip.orderIds).flatMap((id) => {
              const order = orders.find((o) => o.id === id);
              return order ? [order] : [];
            });
            const checks = savedResult.trips.get(trip.ref);
            const late = checks?.violations.some((v) => v.code === "LATE_RISK");
            const budgetClass = schedule?.time.budgetClass;
            const budget = budgetClass ? usage!.budgetByClass[budgetClass] : null;
            const vehicleMinutes = budgetClass ? usage!.minutesByClass[budgetClass] : 0;
            const fuel = (usage?.fuelByTripMl.get(trip.ref) ?? 0) / 1000;
            return (
              <article className="dispatch-card dispatch-trip-column" id={`trip-${trip.ref}`} key={trip.ref}>
                <header className="dispatch-card-heading">
                  <h2>
                    {trip.ref} · {t("tripNumber", { number: trip.tripNo, max: 2 })}
                  </h2>
                  <Pill tone={checks?.ok ? (late ? "warn" : "ok") : "danger"}>
                    {t(checks?.ok ? (late ? "needsReview" : "valid") : "blocked")}
                  </Pill>
                </header>
                <p className="dispatch-muted">
                  {vehicle?.displayId} · {vehicle && t(`temps.${vehicle.temp}`)} ·{" "}
                  {assigned[0] && t(`brands.${assigned[0].brand}`)}
                </p>
                {schedule && (
                  <p>{t("departure", { time: minutes(schedule.departure.display), count: assigned.length })}</p>
                )}
                {late && <Pill tone="warn">{t("lateRisk")}</Pill>}
                <div className="dispatch-trip-meters">
                  <CapacityBar
                    label={t("weight")}
                    used={assigned.reduce((n, o) => n + o.weightG, 0) / 1000}
                    capacity={vehicle ? vehicle.weightCapG / 1000 : null}
                    unit={t("units.kg")}
                    tone="ok"
                  />
                  <CapacityBar
                    label={t("volume")}
                    used={assigned.reduce((n, o) => n + o.volumeL, 0) / 1000}
                    capacity={vehicle ? vehicle.volumeCapL / 1000 : null}
                    unit={t("units.m3")}
                  />
                  <CapacityBar
                    label={t("timeBudget")}
                    used={vehicleMinutes}
                    capacity={schedule ? budget : null}
                    unit={t("units.min")}
                  />
                  <CapacityBar
                    label={t("weeklyFuel")}
                    used={(usage?.weekFuelMl ?? 0) / 1000}
                    capacity={usage ? usage.fuelQuotaMl / 1000 : null}
                    unit={t("units.L")}
                  />
                  <small className="dispatch-muted">
                    {t("tripFuel")}: {fuel.toFixed(1)} {t("units.L")}
                  </small>
                </div>
                {assigned.map((order, index) => orderCard(order, index + 1))}
              </article>
            );
          })}
          {!data.trips.length && <section className="dispatch-card">{t("noTrips")}</section>}
        </div>
        <aside className="dispatch-plan-aside">
          <section className="dispatch-card">
            <ValidationChecks result={savedResult} contextAvailable />
          </section>
          <section className="dispatch-card dispatch-unassigned">
            <h2>
              {t("unassigned")} · {data.unassignedOrderIds.length}
            </h2>
            {orders.filter((o) => data.unassignedOrderIds.includes(o.id)).map((o) => orderCard(o))}
            {!data.unassignedOrderIds.length && <p>{t("noUnassigned")}</p>}
          </section>
        </aside>
      </div>
      {preview && (
        <section className="dispatch-card dispatch-edit-preview">
          <h2>{t("candidateKept")}</h2>
          <ValidationChecks result={result} contextAvailable />
          <div className="dispatch-actions">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setPreview(null);
                onEditingChange(false);
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              loading={busy}
              disabled={disabled || !result.ok}
              onClick={() => {
                void onSave(preview).then((ok) => {
                  if (ok) {
                    setPreview(null);
                    onEditingChange(false);
                  }
                });
              }}
            >
              {t("saveChanges")}
            </Button>
          </div>
        </section>
      )}
      {addOpen && (
        <AddTrip
          data={data}
          orders={orders}
          outlets={outlets}
          vehicles={vehicles}
          reference={reference}
          context={context}
          unavailable={unavailable}
          date={date}
          busy={busy}
          disabled={disabled}
          onClose={() => {
            setAddOpen(false);
            onEditingChange(false);
          }}
          onCreate={onSave}
        />
      )}
    </>
  );
}
