import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router";
import { useIsDesktop } from "../../../lib/layout";
import { formatDay, formatTime } from "../../../lib/time";
import { Button, Modal, StatusPill } from "../../../ui";
import { useOutlet } from "../data";
import { dateInstant } from "../dates";
import { Icon } from "../icons";
import { PhoneScreen } from "../StoreLayout";
import { draft, useDraft, type Order } from "./draft";
import { LineList } from "./parts";

/** The delivery date the orders share, or null when the server put them on different days. */
function deliveryDay(orders: readonly Order[]): string | null {
  const first = orders[0]!.currentDate;
  return orders.every((order) => order.currentDate === first) ? first : null;
}

/** "Delivery Mon 5 Oct", or a line saying the dates differ; each order's card then shows its own. */
function placedSubtitle(t: TFunction<"store/order">, orders: readonly Order[]): string {
  const day = deliveryDay(orders);
  return day ? t("placed.subtitle", { day: formatDay(dateInstant(day)) }) : t("placed.subtitleMixed");
}

/** The confirmation: each order's ID and status, when it was placed, and what is on it. */
function PlacedDetails({ orders }: { orders: readonly Order[] }) {
  const { t } = useTranslation("store/order");
  const outlet = useOutlet().data;
  const first = orders[0]!;
  const sameDate = deliveryDay(orders) !== null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3">
        {orders.map((order) => (
          <div key={order.id} className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-xl bg-surface-2 p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <Icon
                name={order.tempRequirement === "chilled" ? "snow" : "bag"}
                className={`size-4 ${order.tempRequirement === "chilled" ? "text-chilled" : ""}`}
              />
              {t(`summary.order.${order.tempRequirement}`)}
            </p>
            <p className="font-mono text-base font-semibold">{order.displayId}</p>
            {/* Each order is dated by the server on its own, so the two can land on different days. */}
            {!sameDate && (
              <p className="text-xs font-semibold">
                {t("placed.subtitle", { day: formatDay(dateInstant(order.currentDate)) })}
              </p>
            )}
            <div>
              <StatusPill status={order.status} />
            </div>
          </div>
        ))}
      </div>
      <dl className="flex flex-col gap-2.5 rounded-xl border border-border p-3 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-xs text-muted">{t("placed.placedAt")}</dt>
          <dd className="font-semibold">
            {formatDay(first.placedAt)}, {formatTime(first.placedAt)}
          </dd>
        </div>
        {outlet && (
          <div className="flex justify-between gap-3">
            <dt className="text-xs text-muted">{t("placed.outlet")}</dt>
            <dd className="font-semibold">
              <span className="font-mono">{outlet.displayId}</span> · {outlet.district}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-xs text-muted">{t("placed.eta")}</dt>
          <dd className="font-semibold">{t("placed.etaValue")}</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-3 rounded-xl border border-border p-3">
        {orders.map((order) => (
          <div key={order.id} className="flex flex-col gap-2.5">
            <h3 className="text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">
              {t(`placed.group.${order.tempRequirement}`, { id: order.displayId })}
            </h3>
            <LineList
              lines={order.lines.map((line) => ({
                key: line.id,
                name: line.name,
                unitLabel: line.unitLabel,
                qty: line.qtyOrdered,
              }))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function usePlacedActions() {
  const navigate = useNavigate();
  const leave = (to: string) => {
    draft.dismissPlaced();
    void navigate(to);
  };
  return { track: () => leave("/store/tracking"), deliveries: () => leave("/store") };
}

/** Desktop: the "orders placed" dialog over the place-order screen, Figma `233:804`. */
export function PlacedDialog() {
  const { t } = useTranslation("store/order");
  const orders = useDraft((state) => state.placed);
  const { track, deliveries } = usePlacedActions();
  // Mounted only while there is something to show, so the next confirmation starts clean.
  if (!orders || orders.length === 0) return null;
  return (
    <Modal open onClose={draft.dismissPlaced} title={t("placed.title", { count: orders.length })}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{placedSubtitle(t, orders)}</p>
        <PlacedDetails orders={orders} />
        <div className="flex gap-3">
          <Button className="flex-1" icon={<Icon name="route" />} onClick={track}>
            {t("placed.track")}
          </Button>
          <Button variant="secondary" className="flex-1" onClick={deliveries}>
            {t("placed.back")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Phone: the "orders placed" screen, Figma `249:1133`. On desktop the dialog does this job. */
export function PlacedPage() {
  const { t } = useTranslation("store/order");
  const desktop = useIsDesktop();
  const orders = useDraft((state) => state.placed);
  const { track, deliveries } = usePlacedActions();
  if (desktop || !orders || orders.length === 0) return <Navigate to="/store/order" replace />;
  return (
    <PhoneScreen
      title={t("placed.title", { count: orders.length })}
      subtitle={placedSubtitle(t, orders)}
      footer={
        <div className="flex flex-col gap-2">
          <Button size="lg" className="w-full" icon={<Icon name="route" />} onClick={track}>
            {t("placed.track")}
          </Button>
          <Button size="lg" variant="secondary" className="w-full" onClick={deliveries}>
            {t("placed.back")}
          </Button>
        </div>
      }
    >
      <PlacedDetails orders={orders} />
    </PhoneScreen>
  );
}
