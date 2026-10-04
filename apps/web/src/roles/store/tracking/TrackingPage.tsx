import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { useIsDesktop } from "../../../lib/layout";
import { formatDay, formatTime } from "../../../lib/time";
import { Banner, Button, StatusPill } from "../../../ui";
import { dateInstant } from "../dates";
import type { Delivery, Order } from "../deliveries/model";
import { orderUnits } from "../deliveries/model";
import { useBoard, type Board } from "../deliveries/useBoard";
import { Icon } from "../icons";
import { PhoneScreen } from "../StoreLayout";
import { stagesDone, TRACK_STAGES } from "./timeline";

const day = (date: string) => formatDay(dateInstant(date));

export interface Row {
  order: Order;
  trip: Delivery["trip"];
  /** The store's own stop, with the two times of a delivery. */
  stop: NonNullable<Delivery["trip"]>["stops"][number] | null;
}

const WAITING: readonly Order["status"][] = ["ORDERED", "PLANNED", "LOADED", "OUT_FOR_DELIVERY", "DELIVERED"];

/** Every order on the board, the soonest delivery first, then the ones already closed. */
function rowsOf(board: Board): Row[] {
  const fromItem = (item: Delivery): Row => ({
    order: item.order,
    trip: item.trip,
    stop: item.trip?.stops.find((stop) => stop.order.id === item.order.id) ?? null,
  });
  const listed = [...board.nextItems, ...board.items].map(fromItem);
  const moved = [...board.later, ...board.moved]
    .filter((order) => !listed.some((row) => row.order.id === order.id))
    .map((order): Row => ({ order, trip: null, stop: null }));
  const rows = [...listed, ...moved];
  const open = (row: Row) => (WAITING.includes(row.order.status) ? 0 : 1);
  return rows.sort((a, b) => open(a) - open(b) || a.order.currentDate.localeCompare(b.order.currentDate));
}

/** The six shared status words, with the ones this order has passed ticked. */
function Stages({ order, desktop }: { order: Order; desktop: boolean }) {
  const { t } = useTranslation("store/tracking");
  const done = stagesDone(order.status);
  const next = TRACK_STAGES[done];
  if (!desktop) {
    return (
      <div className="flex flex-col gap-2">
        <ol className="flex items-center" aria-hidden="true">
          {TRACK_STAGES.map((stage, index) => (
            <li key={stage} className="flex flex-1 items-center last:flex-none">
              <span
                className={`size-3.5 shrink-0 rounded-full ${
                  index < done ? "bg-ok" : index === done ? "border-2 border-on-panel" : "bg-panel-2"
                }`}
              />
              {index < TRACK_STAGES.length - 1 && (
                <span className={`h-0.5 flex-1 ${index < done - 1 ? "bg-ok" : "bg-panel-2"}`} />
              )}
            </li>
          ))}
        </ol>
        <p className="text-xs">
          {[
            ...TRACK_STAGES.slice(0, done).map((stage) =>
              t("tracking.stageDone", { stage: t(`tracking.stage.${stage}`) }),
            ),
            ...(next ? [t("tracking.stageNext", { stage: t(`tracking.stage.${next}`) })] : []),
          ]
            .slice(-3)
            .join(" · ")}
        </p>
      </div>
    );
  }
  return (
    <ol className="flex flex-1 items-start">
      {TRACK_STAGES.map((stage, index) => (
        <li key={stage} className="relative flex flex-1 flex-col items-center gap-2 text-center">
          {index > 0 && (
            <span
              aria-hidden="true"
              className={`absolute top-4 right-1/2 h-0.5 w-full -translate-y-1/2 ${index < done ? "bg-ok" : "bg-panel-2"}`}
            />
          )}
          <span
            className={`relative flex size-8 items-center justify-center rounded-full text-xs font-semibold ${
              index < done
                ? "bg-ok text-on-panel"
                : index === done
                  ? "border-2 border-on-panel bg-panel"
                  : "bg-panel-2 text-on-panel-muted"
            }`}
          >
            {index < done ? <Icon name="checkCircle" className="size-4" /> : index + 1}
          </span>
          <span className={`text-xs font-semibold ${index <= done ? "" : "text-on-panel-muted"}`}>
            {t(`tracking.stage.${stage}`)}
          </span>
          <span className="text-xs text-on-panel-muted">{t(`tracking.stageBy.${stage}`)}</span>
        </li>
      ))}
    </ol>
  );
}

function Hero({ row, desktop }: { row: Row; desktop: boolean }) {
  const { t } = useTranslation("store/tracking");
  const { t: tDeliveries } = useTranslation("store/deliveries");
  const navigate = useNavigate();
  const { order, trip } = row;
  const temp = tDeliveries(`temp.${order.tempRequirement}`);
  const eta = order.assignment;
  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-panel p-4 text-on-panel lg:gap-6 lg:p-7 xl:flex-row xl:items-center xl:gap-10">
      <div className="flex shrink-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-3 lg:justify-start">
          <p className="text-[11px] font-semibold tracking-[0.06em] text-on-panel-muted uppercase">
            {t("tracking.next", { day: day(order.currentDate) })}
          </p>
          <span className="shrink-0 whitespace-nowrap">
            <StatusPill status={order.status} />
          </span>
        </div>
        <p className="text-3xl leading-[1.2] font-bold lg:text-4xl">
          {eta
            ? tDeliveries("hero.band", { from: formatTime(eta.etaFrom), to: formatTime(eta.etaTo) })
            : t("tracking.waiting")}
        </p>
        <p className="text-xs text-on-panel-muted lg:text-sm">
          {eta && trip
            ? t("tracking.heroLine", { temp, id: order.displayId, trip: trip.displayId, seq: eta.seq })
            : t("tracking.heroLineUnplanned", { temp, id: order.displayId })}
          {" · "}
          {t("tracking.units", { count: orderUnits(order).expected })}
        </p>
        {desktop && (
          <div className="flex gap-3">
            <Button
              variant="on-panel"
              icon={<Icon name="route" />}
              onClick={() => void navigate(`/store/orders/${order.id}`)}
            >
              {t("tracking.timeline")}
            </Button>
            {order.status === "DELIVERED" && (
              <Button variant="ok" onClick={() => void navigate(`/store/orders/${order.id}/receipt`)}>
                {t("tracking.confirm")}
              </Button>
            )}
          </div>
        )}
      </div>
      <Stages order={order} desktop={desktop} />
    </section>
  );
}

function useRowText() {
  const { t } = useTranslation("store/tracking");
  const { t: tDeliveries } = useTranslation("store/deliveries");
  return ({ order, trip, stop }: Row) => {
    const moved = order.requestedDate !== order.currentDate;
    const eta = order.assignment;
    const units = orderUnits(order);
    // The two times of a delivery, once the driver's record has reached the server.
    const handedOver = ["DELIVERED", "RECEIVED", "DISPUTED"].includes(order.status);
    const delivered = handedOver ? stop : null;
    return {
      temp: tDeliveries(`temp.${order.tempRequirement}`),
      date: day(order.currentDate),
      was: moved ? t("tracking.was", { day: day(order.requestedDate) }) : null,
      when: delivered?.deliveredAt
        ? t("tracking.delivered", { time: formatTime(delivered.deliveredAt) })
        : handedOver
          ? // The history list has no stop record, so no times: the order's timeline has them.
            t("tracking.deliveredNoTime")
          : eta
            ? t("tracking.eta", { from: formatTime(eta.etaFrom), to: formatTime(eta.etaTo) })
            : t("tracking.afterPlan"),
      // A delivery's second time, kept apart from the first.
      whenSub: delivered?.deliveredAt
        ? delivered.confirmedAt
          ? t("tracking.confirmed", { time: formatTime(delivered.confirmedAt) })
          : null
        : eta && trip
          ? t("tracking.tripStop", { trip: trip.displayId, seq: eta.seq })
          : null,
      note:
        order.status === "DEFERRED" && order.deferral
          ? tDeliveries(`reasons.${order.deferral.reasonCode}`)
          : order.status === "RECEIVED"
            ? tDeliveries("orders.received", units)
            : order.status === "DISPUTED"
              ? tDeliveries("orders.disputed", units)
              : order.status === "DELIVERED"
                ? tDeliveries("orders.handedOver", units)
                : units.short > 0
                  ? tDeliveries("orders.short", units)
                  : tDeliveries("orders.full", { count: units.ordered }),
    };
  };
}

function TempIcon({ order, className = "" }: { order: Order; className?: string }) {
  const chilled = order.tempRequirement === "chilled";
  return <Icon name={chilled ? "snow" : "bag"} className={`${chilled ? "text-chilled" : "text-muted"} ${className}`} />;
}

export function OrdersTable({ rows }: { rows: readonly Row[] }) {
  const { t } = useTranslation("store/tracking");
  const text = useRowText();
  const head = "px-5 py-3 text-left text-xs font-semibold text-muted";
  return (
    <>
      {/* Seven columns need the width of a 1280 px window. Narrower, the same orders show as the list. */}
      <div className="xl:hidden">
        <OrdersList rows={rows} />
      </div>
      <div className="hidden overflow-hidden rounded-2xl border border-border bg-surface xl:block">
        <table className="w-full text-sm" aria-label={t("tracking.table.label")}>
          <thead className="border-b border-border bg-surface-2">
            <tr>
              {(["order", "type", "date", "eta", "status", "note"] as const).map((column) => (
                <th key={column} scope="col" className={head}>
                  {t(`tracking.table.${column}`)}
                </th>
              ))}
              <th scope="col" className={head} />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const cell = text(row);
              return (
                <tr key={row.order.id}>
                  <td className="px-5 py-4 font-mono font-semibold">{row.order.displayId}</td>
                  <td className="px-5 py-4">
                    <span className="flex items-center gap-2">
                      <TempIcon order={row.order} className="size-4" />
                      {cell.temp}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    {cell.date}
                    {cell.was && <span className="block text-xs text-muted">{cell.was}</span>}
                  </td>
                  <td className="px-5 py-4">
                    {cell.when}
                    {cell.whenSub && <span className="block text-xs text-muted">{cell.whenSub}</span>}
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    <StatusPill status={row.order.status} />
                  </td>
                  <td className="px-5 py-4 text-xs text-muted">{cell.note}</td>
                  <td className="px-5 py-4 text-right">
                    <Link
                      to={`/store/orders/${row.order.id}`}
                      className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm font-semibold whitespace-nowrap"
                    >
                      {row.order.status === "DEFERRED" ? t("tracking.deferred.view") : t("tracking.timelineShort")}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function OrdersList({ rows }: { rows: readonly Row[] }) {
  const text = useRowText();
  return (
    <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-surface px-4">
      {rows.map((row) => {
        const cell = text(row);
        return (
          <li key={row.order.id}>
            <Link to={`/store/orders/${row.order.id}`} className="flex items-center gap-3 py-3">
              <span
                className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
                  row.order.tempRequirement === "chilled" ? "bg-chilled-bg" : "bg-surface-2"
                }`}
              >
                <TempIcon order={row.order} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-sm font-semibold">{row.order.displayId}</span>
                <span className="mt-0.5 block text-xs text-muted">
                  {[cell.temp, cell.date, cell.when, cell.whenSub].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="shrink-0 whitespace-nowrap">
                <StatusPill status={row.order.status} />
              </span>
              <Icon name="chevronRight" className="size-4 text-faint" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Order tracking. Desktop: Figma `232:587`. Phone: `249:1260`. */
export function TrackingPage() {
  const { t } = useTranslation("store/tracking");
  const { t: tDeliveries } = useTranslation("store/deliveries");
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const board = useBoard();
  const rows = rowsOf(board);
  const next = rows.find((row) => WAITING.includes(row.order.status)) ?? null;
  const deferred = rows.filter((row) => row.order.status === "DEFERRED" && row.order.deferral);
  const stamp = { day: formatDay(board.now), time: formatTime(board.now) };

  const hero = board.loading ? null : next ? (
    <Hero row={next} desktop={desktop} />
  ) : (
    <section className="flex flex-col gap-2 rounded-2xl bg-panel p-4 text-on-panel lg:p-7">
      <p className="text-xl leading-[1.3] font-semibold lg:text-2xl">{t("tracking.none.title")}</p>
      <p className="text-sm text-on-panel-muted">{t("tracking.none.body")}</p>
    </section>
  );
  const notices = deferred.map(({ order }) => (
    <Banner
      key={order.id}
      tone="deferred"
      icon={<Icon name="minusCircle" />}
      message={t("tracking.deferred.title", {
        temp: tDeliveries(`temp.${order.tempRequirement}`),
        id: order.displayId,
        day: day(order.deferral!.toDate),
      })}
      detail={t("tracking.deferred.body", { reason: tDeliveries(`reasons.${order.deferral!.reasonCode}`) })}
      action={
        <Button variant="secondary" onClick={() => void navigate(`/store/orders/${order.id}`)}>
          {t("tracking.deferred.view")}
        </Button>
      }
    />
  ));
  const failed = board.failed && (
    <Banner
      tone="danger"
      message={tDeliveries("loadFailed")}
      action={
        <Button variant="secondary" onClick={board.refresh}>
          {tDeliveries("retry")}
        </Button>
      }
    />
  );
  const empty = !board.loading && rows.length === 0 && <p className="text-sm text-muted">{t("tracking.empty")}</p>;

  if (!desktop) {
    return (
      <PhoneScreen nav title={t("tracking.title")} subtitle={t("tracking.subtitle", stamp)}>
        {failed}
        {hero}
        {notices}
        {rows.length > 0 && <OrdersList rows={rows} />}
        {empty}
      </PhoneScreen>
    );
  }
  return (
    <main className="flex flex-col gap-6 p-8">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">
          {t("tracking.eyebrow", stamp)}
        </p>
        <h1 className="mt-2 text-3xl leading-[1.25] font-bold tracking-[-0.01em]">{t("tracking.title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("tracking.intro")}</p>
      </div>
      {failed}
      {hero}
      {notices}
      {rows.length > 0 && <OrdersTable rows={rows} />}
      {empty}
      <p className="text-xs text-muted">{t("tracking.footnote")}</p>
    </main>
  );
}
