import { useState } from "react";
import { runUsage, type ValidationContext } from "@nextdrop/rules";
import { useTranslation } from "react-i18next";
import { Button, Modal, CapacityBar } from "../../ui";
import {
  addTrip,
  evaluate,
  type DraftData,
  type Order,
  type Outlet,
  type Vehicle,
  type BrowserReference,
} from "./planning";
import { ValidationChecks } from "./ValidationChecks";

interface Props {
  data: DraftData;
  orders: readonly Order[];
  outlets: readonly Outlet[];
  vehicles: readonly Vehicle[];
  reference: BrowserReference;
  context: ValidationContext;
  unavailable: ReadonlySet<string>;
  date: string;
  busy: boolean;
  disabled: boolean;
  onClose: () => void;
  onCreate: (data: DraftData) => Promise<boolean>;
}
export function AddTrip({
  data,
  orders,
  outlets,
  vehicles,
  reference,
  context,
  unavailable,
  date,
  busy,
  disabled,
  onClose,
  onCreate,
}: Props) {
  const { t } = useTranslation("dispatcher/planning");
  const slots = vehicles
    .filter((v) => !unavailable.has(v.displayId))
    .flatMap((v) =>
      ([1, 2] as const)
        .filter((tripNo) => !data.trips.some((trip) => trip.vehicleId === v.id && trip.tripNo === tripNo))
        .map((tripNo) => ({ vehicle: v, tripNo, value: `${v.id}|${tripNo}` })),
    );
  const [slotValue, setSlotValue] = useState(slots[0]?.value ?? "");
  const [district, setDistrict] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const slot = slots.find((s) => s.value === slotValue);
  const nextRef = `T${String(Math.max(0, ...data.trips.map((trip) => Number(trip.ref.replace(/^T/, "")) || 0)) + 1).padStart(3, "0")}`;
  const candidate = slot
    ? addTrip(data, { ref: nextRef, vehicleId: slot.vehicle.id, tripNo: slot.tripNo, orderIds: ids })
    : data;
  const result = evaluate(candidate, orders, date, reference, unavailable, context);
  const selected = orders.filter((o) => ids.includes(o.id));
  const unassigned = orders.filter((o) => data.unassignedOrderIds.includes(o.id));
  const shown = unassigned.filter(
    (o) => !district || outlets.find((out) => out.id === o.outletId)?.district === district,
  );
  const plan = result.plan;
  const trip = plan.trips.find((trip) => trip.ref === nextRef);
  const rulesVehicle = slot ? reference.ref.vehicles.get(slot.vehicle.displayId) : undefined;
  const usage = rulesVehicle ? runUsage(plan.trips, rulesVehicle, reference.ref, context) : undefined;
  const schedule = usage?.schedules.find((item) => item.trip.ref === nextRef);
  const budgetClass = schedule?.time.budgetClass;
  const vehicleMinutes = budgetClass ? usage!.minutesByClass[budgetClass] : 0;
  const budget = budgetClass ? usage!.budgetByClass[budgetClass] : null;
  const fuel = (usage?.fuelByTripMl.get(nextRef) ?? 0) / 1000;
  const valid = slot && ids.length > 0 && result.ok && !busy && !disabled;
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={t("addTitle", { ref: nextRef })}
    >
      <p>{t("addIntro")}</p>
      <div className="dispatch-modal-fields">
        <label>
          {t("vehicle")}
          <select disabled={busy} value={slotValue} onChange={(e) => setSlotValue(e.target.value)}>
            {slots.map((s) => (
              <option key={s.value} value={s.value}>
                {s.vehicle.displayId} · {t(`temps.${s.vehicle.temp}`)} · {t("tripNumber", { number: s.tripNo, max: 2 })}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("brand")}
          <input readOnly value={[...new Set(selected.map((o) => t(`brands.${o.brand}`)))].join(" · ")} />
        </label>
        <label>
          {t("district")}
          <select
            disabled={busy}
            value={district}
            onChange={(e) => {
              setDistrict(e.target.value);
              setIds([]);
            }}
          >
            <option value="">{t("allDistricts")}</option>
            {[...new Set(outlets.filter((out) => unassigned.some((o) => o.outletId === out.id)).map((o) => o.district))]
              .sort()
              .map((d) => (
                <option key={d}>{d}</option>
              ))}
          </select>
        </label>
      </div>
      {!slots.length && <p>{t("noSlots")}</p>}
      <h3>{t("chooseOrders")}</h3>
      <div className="dispatch-order-choices">
        {shown.map((order) => (
          <label key={order.id}>
            <input
              type="checkbox"
              disabled={busy}
              checked={ids.includes(order.id)}
              onChange={(e) => setIds(e.target.checked ? [...ids, order.id] : ids.filter((id) => id !== order.id))}
            />
            <span>
              <strong>
                {order.displayId} · {outlets.find((out) => out.id === order.outletId)?.name}
              </strong>
              <small>
                {t(`brands.${order.brand}`)} · {order.weightG / 1000} {t("units.kg")} · {order.volumeL / 1000}{" "}
                {t("units.m3")}
              </small>
            </span>
          </label>
        ))}
      </div>
      {slot && trip && (
        <div className="dispatch-modal-meters">
          <CapacityBar
            label={t("weight")}
            used={selected.reduce((n, o) => n + o.weightG, 0) / 1000}
            capacity={slot.vehicle.weightCapG / 1000}
            unit={t("units.kg")}
            tone="ok"
          />
          <CapacityBar
            label={t("volume")}
            used={selected.reduce((n, o) => n + o.volumeL, 0) / 1000}
            capacity={slot.vehicle.volumeCapL / 1000}
            unit={t("units.m3")}
          />
          <CapacityBar
            label={t("tripTime")}
            used={schedule?.time.totalMin ?? 0}
            capacity={schedule ? budget : null}
            unit={t("units.min")}
          />
          <CapacityBar
            label={t("vehicleDay")}
            used={vehicleMinutes}
            capacity={schedule ? budget : null}
            unit={t("units.min")}
          />
          <p>
            {t("tripFuel")}:{" "}
            <strong>
              {fuel.toFixed(1)} {t("units.L")}
            </strong>
          </p>
          <CapacityBar
            label={t("weeklyFuel")}
            used={(usage?.weekFuelMl ?? 0) / 1000}
            capacity={usage ? usage.fuelQuotaMl / 1000 : null}
            unit={t("units.L")}
          />
        </div>
      )}
      <ValidationChecks result={result} contextAvailable />
      <p className="dispatch-muted">{ids.length ? t("selectedCount", { count: ids.length }) : t("selectionEmpty")}</p>
      <div className="dispatch-actions">
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button
          disabled={!valid}
          loading={busy}
          onClick={() => {
            void onCreate(candidate).then((ok) => {
              if (ok) onClose();
            });
          }}
        >
          {t("createTrip", { ref: nextRef })}
        </Button>
      </div>
    </Modal>
  );
}
