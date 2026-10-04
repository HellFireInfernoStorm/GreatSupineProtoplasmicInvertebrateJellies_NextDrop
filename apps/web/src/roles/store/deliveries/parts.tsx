import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { formatDay, formatTime } from "../../../lib/time";
import { Banner, Button, Sheet, StatusPill } from "../../../ui";
import { Pill } from "../../../ui/StatusPill";
import { dateInstant, weekdayLong } from "../dates";
import { Icon } from "../icons";
import { useCountdownText } from "../order/countdown";
import { draft } from "../order/draft";
import type { OrderModel } from "../order/useOrderModel";
import { confirmable, orderUnits, shortOn, stageProgress, type Alert, type Order, type Run } from "./model";

// The pieces of My deliveries, shared by the desktop screen (Figma `230:136`) and the phone screen (`248:960`).

const band = (from: string, to: string) => ({ from: formatTime(from), to: formatTime(to) });
const day = (date: string) => formatDay(dateInstant(date));

function HeroShell({ children }: { children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-panel p-4 text-on-panel lg:gap-5 lg:p-7">{children}</section>
  );
}

/** The dark card when no run is on the way: nothing due, or orders still waiting for the plan. */
export function HeroEmpty({ waiting }: { waiting: boolean }) {
  const { t } = useTranslation("store/deliveries");
  const key = waiting ? "waiting" : "none";
  return (
    <HeroShell>
      <p className="text-xl leading-[1.3] font-semibold lg:text-2xl">{t(`hero.${key}.title`)}</p>
      <p className="text-sm text-on-panel-muted">{t(`hero.${key}.body`)}</p>
    </HeroShell>
  );
}

interface HeroProps {
  run: Run;
  desktop: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}

/** The dark card for the run on its way: ETA band, trip and stop, how far along it is, and the actions. */
export function Hero({ run, desktop, refreshing, onRefresh }: HeroProps) {
  const { t } = useTranslation("store/deliveries");
  const navigate = useNavigate();
  const first = run.orders[0]!;
  const toConfirm = confirmable(run);
  const silent = run.state === "nosignal";
  const handedOver = run.deliveredAt !== null && (run.state === "delivered" || run.state === "closed");
  const trip = { trip: run.trip.displayId, seq: run.seq };
  return (
    <HeroShell>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold tracking-[0.06em] text-on-panel-muted uppercase">
          {t(`hero.eyebrow.${run.state}`)}
        </p>
        <span className="shrink-0 whitespace-nowrap">
          {silent ? <Pill tone="neutral">{t("hero.noSignal")}</Pill> : <StatusPill status={run.status} />}
        </span>
      </div>
      <div>
        <p className="text-3xl leading-[1.2] font-bold lg:text-4xl">{t("hero.band", band(run.etaFrom, run.etaTo))}</p>
        <p className="mt-2 text-xs text-on-panel-muted lg:text-sm">
          {t(desktop ? "hero.line" : "hero.lineShort", trip)}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <div
          role="progressbar"
          aria-label={t(`hero.stage.${run.status}`, { defaultValue: "" })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(stageProgress(run.status) * 100)}
          className="h-1.5 overflow-hidden rounded-full bg-panel-2"
        >
          <div
            className={`h-full rounded-full ${silent ? "bg-on-panel-muted" : "bg-ok"}`}
            style={{ width: `${stageProgress(run.status) * 100}%` }}
          />
        </div>
        {/* A delivery made offline has two times, shown side by side and never merged. */}
        {handedOver ? (
          <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs">
            <span className="font-semibold">{t("hero.delivered", { time: formatTime(run.deliveredAt!) })}</span>
            {run.confirmedAt && (
              <span className="text-on-panel-muted">{t("hero.confirmed", { time: formatTime(run.confirmedAt) })}</span>
            )}
          </p>
        ) : (
          <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs">
            <span className="font-semibold">{t(`hero.stage.${run.status}`, { defaultValue: "" })}</span>
            <span className="text-on-panel-muted">
              {run.status === "PLANNED" || run.status === "LOADED"
                ? t("hero.departs", { time: formatTime(run.trip.plannedDepart) })
                : run.lastHeardAt === null
                  ? t("hero.neverHeard")
                  : t(silent ? "hero.heard" : "hero.updated", { time: formatTime(run.lastHeardAt) })}
            </span>
          </p>
        )}
      </div>
      <div className="flex flex-col gap-3 border-panel-line lg:flex-row lg:items-end lg:justify-between lg:border-t lg:pt-5">
        <div className="hidden lg:block">
          <p className="text-xs text-on-panel-muted">{t("hero.unload")}</p>
          <p className="mt-1 text-sm font-semibold">
            {run.orders
              .map((order) => t(`hero.units.${order.tempRequirement}`, { count: orderUnits(order).expected }))
              .join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:gap-3">
          <Button
            variant="on-panel"
            className="flex-1 lg:flex-none"
            icon={<Icon name="route" />}
            onClick={() => void navigate(`/store/orders/${first.id}`)}
          >
            {t(desktop ? "hero.timeline" : "hero.timelineShort")}
          </Button>
          {silent ? (
            <Button
              variant="on-panel-outline"
              className="flex-1 lg:flex-none"
              icon={<Icon name="refresh" />}
              loading={refreshing}
              onClick={onRefresh}
            >
              {t("hero.refresh")}
            </Button>
          ) : (
            <Button
              variant="on-panel-outline"
              className="flex-1 lg:flex-none"
              onClick={() => void navigate("/store/tracking")}
            >
              {t("hero.details")}
            </Button>
          )}
          {run.state !== "closed" && (
            <Button
              variant="ok"
              className="w-full lg:w-auto"
              disabled={toConfirm === null}
              onClick={() => toConfirm && void navigate(`/store/orders/${toConfirm.id}/receipt`)}
            >
              {t(silent ? "hero.confirmWaiting" : "hero.confirm")}
            </Button>
          )}
        </div>
      </div>
    </HeroShell>
  );
}

/** The neutral note under a silent run: the truck is not late, its phone is out of coverage. */
export function NoSignalNote({ onExplain }: { onExplain: () => void }) {
  const { t } = useTranslation("store/deliveries");
  return (
    <Banner
      tone="neutral"
      icon={<Icon name="clock" />}
      message={t("noSignal.title")}
      detail={
        <>
          <p>{t("noSignal.body")}</p>
          <button
            type="button"
            onClick={onExplain}
            className="-mb-2 flex min-h-11 items-center text-xs font-semibold text-link underline"
          >
            {t("noSignal.link")}
          </button>
        </>
      }
    />
  );
}

/** The "late or lost?" sheet (Figma `491:1651`): grey is no signal, amber is late, and nothing is lost. */
export function LateOrLostSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation("store/deliveries");
  if (!open) return null;
  return (
    <Sheet open onClose={onClose} title={t("lateOrLost.title")}>
      <div className="flex flex-col gap-4">
        <dl className="flex flex-col gap-3 text-sm">
          <div className="flex items-start gap-3">
            <dt className="w-28 shrink-0">
              <Pill tone="neutral">{t("lateOrLost.grey")}</Pill>
            </dt>
            <dd className="text-muted">{t("lateOrLost.greyBody")}</dd>
          </div>
          <div className="flex items-start gap-3">
            <dt className="w-28 shrink-0">
              <Pill tone="warn">{t("lateOrLost.amber")}</Pill>
            </dt>
            <dd className="text-muted">{t("lateOrLost.amberBody")}</dd>
          </div>
        </dl>
        <div className="rounded-xl bg-surface-2 p-3 text-sm">
          <p className="font-semibold">{t("lateOrLost.nothingLost")}</p>
          <p className="mt-1 text-muted">{t("lateOrLost.nothingLostBody")}</p>
        </div>
        <Button className="w-full" onClick={onClose}>
          {t("lateOrLost.close")}
        </Button>
      </div>
    </Sheet>
  );
}

function useAlertText() {
  const { t } = useTranslation("store/deliveries");
  return (alert: Alert) => {
    const temp = t(`temp.${alert.order.tempRequirement}`);
    if (alert.kind === "deferred") {
      return {
        title: t("alerts.deferred.title", { temp }),
        body: t("alerts.deferred.body", {
          id: alert.order.displayId,
          to: day(alert.deferral.toDate),
          reason: t(`reasons.${alert.deferral.reasonCode}`),
        }),
      };
    }
    const lines = alert.order.lines
      .map((line) => ({ name: line.name, qty: shortOn(alert.order, line) }))
      .filter((line) => line.qty > 0)
      .map((line) => t("alerts.shortLine", line))
      .join(", ");
    return {
      title: t("alerts.partial.title", { temp }),
      body: t("alerts.partial.body", {
        id: alert.order.displayId,
        expected: alert.expected,
        ordered: alert.ordered,
        lines,
      }),
    };
  };
}

/** Phone: one banner per alert, amber for a partial delivery and the deferred tone for a moved order. */
export function AlertBanners({ alerts }: { alerts: readonly Alert[] }) {
  const text = useAlertText();
  return (
    <>
      {alerts.map((alert) => {
        const { title, body } = text(alert);
        return (
          <Banner
            key={`${alert.kind}-${alert.order.id}`}
            tone={alert.kind === "partial" ? "warn" : "deferred"}
            icon={<Icon name={alert.kind === "partial" ? "flag" : "minusCircle"} />}
            message={title}
            detail={body}
          />
        );
      })}
    </>
  );
}

/** Desktop: the Alerts card. */
export function AlertsCard({ alerts }: { alerts: readonly Alert[] }) {
  const { t } = useTranslation("store/deliveries");
  const text = useAlertText();
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("alerts.title")}</h2>
        {alerts.length > 0 && <Pill tone="warn">{t("alerts.count", { count: alerts.length })}</Pill>}
      </div>
      {alerts.length === 0 ? (
        <p className="text-sm text-muted">{t("alerts.none")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {alerts.map((alert) => {
            const { title, body } = text(alert);
            const partial = alert.kind === "partial";
            return (
              <li key={`${alert.kind}-${alert.order.id}`} className="flex gap-3 py-4 first:pt-0 last:pb-0">
                <span
                  className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
                    partial ? "bg-warn-bg text-warn-fg" : "bg-deferred-bg text-deferred-fg"
                  }`}
                >
                  <Icon name={partial ? "flag" : "minusCircle"} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="mt-1 text-xs text-muted">{body}</p>
                  <Link to={`/store/orders/${alert.order.id}`} className="mt-1.5 inline-block text-xs font-semibold">
                    {t("orders.view")}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function useOrderLine() {
  const { t } = useTranslation("store/deliveries");
  return (order: Order): string => {
    const units = orderUnits(order);
    if (order.status === "DEFERRED" && order.deferral) {
      return t("orders.movedTo", {
        day: day(order.deferral.toDate),
        reason: t(`reasons.${order.deferral.reasonCode}`),
      });
    }
    if (order.status === "ORDERED") return t("orders.waiting");
    if (order.status === "RECEIVED") return t("orders.received", units);
    if (order.status === "DISPUTED") return t("orders.disputed", units);
    if (order.status === "DELIVERED") return t("orders.handedOver", units);
    const base = units.short > 0 ? t("orders.short", units) : t("orders.full", { count: units.ordered });
    const moved =
      order.deferredCount > 0 && order.requestedDate !== order.currentDate
        ? ` · ${t("orders.deferredFrom", { day: day(order.requestedDate) })}`
        : "";
    return base + moved;
  };
}

/** One order in a list: what it is, what to expect, its status, and a way to its timeline. */
function OrderRow({ order, desktop }: { order: Order; desktop: boolean }) {
  const { t } = useTranslation("store/deliveries");
  const line = useOrderLine();
  const chilled = order.tempRequirement === "chilled";
  const { short } = orderUnits(order);
  const closed = order.status === "RECEIVED" || order.status === "DISPUTED";
  const body = (
    <>
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
          chilled ? "bg-chilled-bg text-chilled" : "bg-surface-2 text-muted"
        }`}
      >
        <Icon name={chilled ? "snow" : "bag"} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">
          {t(`temp.${order.tempRequirement}`)} · <span className="font-mono">{order.displayId}</span>
        </span>
        <span className="mt-0.5 block text-xs text-muted">{line(order)}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        {short > 0 && !closed && <Pill tone="warn">{t("orders.shortPill", { count: short })}</Pill>}
        <StatusPill status={order.status} />
      </span>
    </>
  );
  if (!desktop) {
    return (
      <li>
        <Link to={`/store/orders/${order.id}`} className="flex items-center gap-3 py-3">
          {body}
        </Link>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-4 rounded-xl border border-border p-4">
      {body}
      <Link
        to={`/store/orders/${order.id}`}
        className="flex h-10 shrink-0 items-center rounded-lg border border-border px-4 text-sm font-semibold"
      >
        {t("orders.timeline")}
      </Link>
    </li>
  );
}

interface OrdersCardProps {
  title: string;
  aside?: string;
  orders: readonly Order[];
  desktop: boolean;
  empty?: string;
  hint?: string;
  action?: ReactNode;
}

/** A day's orders: today's, or the next delivery day's with any order that was moved. */
export function OrdersCard({ title, aside, orders, desktop, empty, hint, action }: OrdersCardProps) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 lg:gap-4 lg:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold lg:text-lg">{title}</h2>
        {aside && <p className="text-xs text-muted">{aside}</p>}
      </div>
      {orders.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className={desktop ? "flex flex-col gap-3" : "flex flex-col divide-y divide-border"}>
          {orders.map((order) => (
            <OrderRow key={order.id} order={order} desktop={desktop} />
          ))}
        </ul>
      )}
      {action}
      {hint && orders.length > 0 && <p className="text-xs text-muted">{hint}</p>}
    </section>
  );
}

/** The next order the manager can place: time left to its cutoff, and the two ways to start it. */
export function NextOrderCard({ model, desktop }: { model: OrderModel; desktop: boolean }) {
  const { t } = useTranslation("store/deliveries");
  const navigate = useNavigate();
  const left = useCountdownText(model.cutoffAtMs, model.nowMs);
  const cutoff = new Date(model.cutoffAtMs);
  const repeat = () => {
    draft.fill(model.lastQty, model.products);
    void navigate("/store/order");
  };
  if (!desktop) {
    return (
      <section className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
          <Icon name="clock" />
        </span>
        <p className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{t("next.phoneTitle", { day: day(model.date) })}</span>
          <span className="block text-xs text-muted">{t("next.phoneLeft", { left })}</span>
        </p>
        <Button icon={<Icon name="plus" />} onClick={() => void navigate("/store/order")}>
          {t("next.order")}
        </Button>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-5 rounded-2xl bg-panel p-7 text-on-panel">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.06em] text-on-panel-muted uppercase">
          {t("next.eyebrow", { day: day(model.date) })}
        </p>
        <p className="mt-2 text-3xl leading-[1.2] font-bold">{left}</p>
        <p className="mt-1.5 text-sm text-on-panel-muted">
          {t("next.left", { day: formatDay(cutoff), time: formatTime(cutoff) })}
        </p>
      </div>
      <div className="flex flex-col gap-2.5">
        <Button
          variant="on-panel"
          className="w-full"
          icon={<Icon name="repeat" />}
          disabled={Object.keys(model.lastQty).length === 0}
          onClick={repeat}
        >
          {t("next.repeat", { weekday: weekdayLong(model.date) })}
        </Button>
        <Button
          variant="on-panel-outline"
          className="w-full"
          icon={<Icon name="plus" />}
          onClick={() => void navigate("/store/order")}
        >
          {t("next.place")}
        </Button>
      </div>
    </section>
  );
}
