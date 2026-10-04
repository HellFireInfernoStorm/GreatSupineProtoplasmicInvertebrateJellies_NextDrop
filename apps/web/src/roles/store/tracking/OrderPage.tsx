import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { ApiRequestError } from "../../../lib/api";
import { useIsDesktop } from "../../../lib/layout";
import { formatDay, formatTime } from "../../../lib/time";
import { Banner, Button, StatusPill, Timeline, type TimelineEvent } from "../../../ui";
import { useDeliveries, useOrder, useOutlet } from "../data";
import { dateInstant } from "../dates";
import { Icon } from "../icons";
import { PhoneScreen } from "../StoreLayout";
import { canReport } from "../receipt/receipt";
import { timelineSteps, type OrderDetail, type Step } from "./timeline";

const day = (date: string) => formatDay(dateInstant(date));

/** Turns a step into the text the shared Timeline shows. */
function useStepText() {
  const { t } = useTranslation("store/tracking");
  const { t: tDeliveries } = useTranslation("store/deliveries");
  return (step: Step): TimelineEvent => {
    const p = step.params;
    const params = {
      ...p,
      day: typeof p.toDate === "string" ? day(p.toDate) : undefined,
      reason: typeof p.reasonCode === "string" ? tDeliveries(`reasons.${p.reasonCode}`) : undefined,
      from: typeof p.etaFrom === "string" ? formatTime(p.etaFrom) : undefined,
      to: typeof p.etaTo === "string" ? formatTime(p.etaTo) : undefined,
      kind: typeof p.issueKind === "string" ? t(`issueKind.${p.issueKind}`) : undefined,
      resolution: typeof p.resolution === "string" ? t(`resolution.${p.resolution}`) : undefined,
    };
    return {
      id: step.id,
      title: t(`step.title.${step.kind}`),
      detail: t(`step.detail.${step.kind}`, params),
      actor: t(`role.${step.role}`),
      capturedAt: step.capturedAt,
      confirmedAt: step.confirmedAt,
    };
  };
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-xl bg-surface-2 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function Body({ detail }: { detail: OrderDetail }) {
  const { t } = useTranslation("store/tracking");
  const { t: tDeliveries } = useTranslation("store/deliveries");
  const text = useStepText();
  const { order } = detail;
  // The trip's short ID and the driver's contact state come with the day's deliveries, not with the order.
  const delivery = useDeliveries(order.currentDate).data?.items.find((item) => item.order.id === order.id);
  const moved = order.requestedDate !== order.currentDate;
  const handedOver = ["DELIVERED", "RECEIVED", "DISPUTED"].includes(order.status);
  const silent = delivery?.signal === "NO_SIGNAL" && !handedOver;
  return (
    <>
      <div className="flex gap-3">
        <Tile
          label={t("order.delivery")}
          value={day(order.currentDate)}
          sub={moved ? t("order.from", { day: day(order.requestedDate) }) : undefined}
        />
        {order.assignment ? (
          <Tile
            label={t("order.trip")}
            value={
              delivery?.trip
                ? t("order.tripValue", { trip: delivery.trip.displayId, seq: order.assignment.seq })
                : t("order.tripEta", {
                    from: formatTime(order.assignment.etaFrom),
                    to: formatTime(order.assignment.etaTo),
                  })
            }
            sub={
              delivery?.trip
                ? t("order.tripEta", {
                    from: formatTime(order.assignment.etaFrom),
                    to: formatTime(order.assignment.etaTo),
                  })
                : undefined
            }
          />
        ) : (
          <Tile label={t("order.trip")} value={t("order.notPlanned")} sub={t("order.notPlannedBody")} />
        )}
      </div>
      {order.status === "DEFERRED" && order.deferral && (
        <Banner
          tone="deferred"
          icon={<Icon name="minusCircle" />}
          message={t("order.deferral.title", { day: day(order.deferral.toDate) })}
          detail={t("order.deferral.body", {
            reason: tDeliveries(`reasons.${order.deferral.reasonCode}`),
            from: day(order.requestedDate),
          })}
        />
      )}
      {silent && (
        <Banner
          tone="neutral"
          icon={<Icon name="clock" />}
          message={
            delivery.lastHeardAt
              ? t("order.noSignal", { time: formatTime(delivery.lastHeardAt) })
              : t("order.noSignalNever")
          }
          detail={t("order.noSignalBody")}
        />
      )}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("order.happened")}</h2>
        <Timeline events={timelineSteps(detail.timeline).map(text)} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("order.lines")}</h2>
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border px-3">
          {order.lines.map((line) => (
            <li key={line.id} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0">
                {line.name} · {line.unitLabel}
              </span>
              <span className="shrink-0 text-xs text-muted">
                {[
                  t("order.ordered", { count: line.qtyOrdered }),
                  handedOver
                    ? t("order.deliveredQty", { count: line.qtyDelivered })
                    : line.qtyLoaded > 0
                      ? t("order.loaded", { count: line.qtyLoaded })
                      : null,
                  order.status === "RECEIVED" ? t("order.receivedQty", { count: line.qtyReceived }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/**
 * One order: its timeline and what is on it. Phone: Figma `250:1208` and `250:1429`; a deferred order shows its
 * notice (`249:1206`), a silent driver the "waiting for sync" note (`491:1796`).
 */
export function OrderPage() {
  const { t } = useTranslation("store/tracking");
  const { t: tDeliveries } = useTranslation("store/deliveries");
  const { id = "" } = useParams();
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const outlet = useOutlet().data;
  const detail = useOrder(id);
  const order = detail.data?.order;

  const state = detail.isPending ? null : detail.isError ? (
    <Banner
      tone="danger"
      message={
        detail.error instanceof ApiRequestError && detail.error.status === 404
          ? t("order.notFound")
          : t("order.loadFailed")
      }
      action={
        <Button variant="secondary" onClick={() => void detail.refetch()}>
          {t("order.retry")}
        </Button>
      }
    />
  ) : null;
  const temp = order ? tDeliveries(`temp.${order.tempRequirement}`) : "";
  const subtitle = order
    ? outlet
      ? t("order.subtitleOutlet", { id: order.displayId, temp, outlet: outlet.displayId })
      : t("order.subtitle", { id: order.displayId, temp })
    : undefined;
  const actions = order && canReport(order.status) && (
    <div className="flex flex-col gap-2 lg:flex-row">
      {order.status === "DELIVERED" && (
        <Button size="lg" className="w-full lg:w-auto" onClick={() => void navigate(`/store/orders/${id}/receipt`)}>
          {t("order.confirm")}
        </Button>
      )}
      <Button
        size="lg"
        variant="secondary"
        className="w-full lg:w-auto"
        onClick={() => void navigate(`/store/orders/${id}/issue`)}
      >
        {t("order.report")}
      </Button>
    </div>
  );

  if (!desktop) {
    return (
      <PhoneScreen
        title={t("order.title")}
        subtitle={subtitle}
        back={{ to: "/store/tracking", label: t("order.back") }}
        footer={actions || undefined}
      >
        {order && (
          <div>
            <StatusPill status={order.status} />
          </div>
        )}
        {state}
        {detail.data && <Body detail={detail.data} />}
      </PhoneScreen>
    );
  }
  return (
    <main className="flex max-w-3xl flex-col gap-6 p-8">
      <div>
        <Link to="/store/tracking" className="flex items-center gap-2 text-xs font-semibold text-muted">
          <Icon name="arrowLeft" className="size-4" />
          {t("order.back")}
        </Link>
        <div className="mt-3 flex items-center gap-4">
          <h1 className="text-3xl leading-[1.25] font-bold tracking-[-0.01em]">{t("order.title")}</h1>
          {order && <StatusPill status={order.status} />}
        </div>
        {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
      </div>
      {state}
      {detail.data && (
        <section className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-6">
          <Body detail={detail.data} />
          {actions}
        </section>
      )}
    </main>
  );
}
