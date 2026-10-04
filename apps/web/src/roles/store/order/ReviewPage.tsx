import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router";
import { useIsDesktop } from "../../../lib/layout";
import { formatDay, formatTime } from "../../../lib/time";
import { Button, ChilledPill } from "../../../ui";
import { dateInstant } from "../dates";
import { Icon } from "../icons";
import { PhoneScreen } from "../StoreLayout";
import { useCountdownText } from "./countdown";
import { draftLineItems, totalUnits, useDraft } from "./draft";
import { GuidanceNotice, LineList, SubmitFailureBanner } from "./parts";
import { useOrderModel } from "./useOrderModel";
import { useSubmitOrders } from "./useSubmitOrders";

/**
 * Phone: Review orders, Figma `248:1301`. One card per order, then Submit. On desktop the order summary on the
 * place-order screen does this job, so the route goes back there.
 */
export function ReviewPage() {
  const { t } = useTranslation("store/order");
  const desktop = useIsDesktop();
  const model = useOrderModel();
  const { pending, failure, submit } = useSubmitOrders();
  const left = useCountdownText(model.cutoffAtMs, model.nowMs);

  const placed = useDraft((state) => state.placed);

  if (desktop) return <Navigate to="/store/order" replace />;
  // Placing the orders empties the draft, so the confirmation has to win over the "nothing to review" redirect.
  if (placed) return <Navigate to="/store/order/placed" replace />;
  if (model.orders.length === 0 && !pending) return <Navigate to="/store/order" replace />;

  return (
    <PhoneScreen
      title={t("review.title")}
      subtitle={t("review.subtitle", {
        day: formatDay(dateInstant(model.date)),
        outlet: model.outlet ? `${model.outlet.displayId} ${model.outlet.district}` : "",
      })}
      back={{ to: "/store/order", label: t("catalogue.back") }}
      footer={
        <Button
          size="lg"
          className="w-full"
          icon={<Icon name="send" />}
          loading={pending}
          onClick={() => void submit(model.date, model.orders)}
        >
          {pending ? t("submitting") : t("submit", { count: model.orders.length })}
        </Button>
      }
    >
      <p className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-xs">
        <Icon name="clock" className="size-4 text-muted" />
        {t("cutoff.review", { time: formatTime(new Date(model.cutoffAtMs)), left })}
      </p>
      <GuidanceNotice model={model} />
      <SubmitFailureBanner failure={failure} />
      {model.orders.map((order) => (
        <section key={order.temp} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2.5 text-base font-semibold">
              <span
                className={`flex size-8 items-center justify-center rounded-full ${
                  order.temp === "chilled" ? "bg-chilled-bg text-chilled" : "bg-surface-2 text-muted"
                }`}
              >
                <Icon name={order.temp === "chilled" ? "snow" : "bag"} className="size-4" />
              </span>
              {t(`summary.order.${order.temp}`)}
            </h2>
            {order.temp === "chilled" ? (
              <ChilledPill />
            ) : (
              <span className="rounded-full bg-neutral-bg px-2.5 py-1 text-[11px] font-semibold text-neutral">
                {t("summary.units", { count: totalUnits(order.lines) })}
              </span>
            )}
          </div>
          <LineList lines={draftLineItems(order.lines)} />
          <Link to={`/store/order/items?order=${order.temp}`} className="self-start py-2 text-sm font-semibold">
            {t(`review.edit.${order.temp}`)}
          </Link>
        </section>
      ))}
      <p className="text-xs leading-[1.5] text-muted">{t("review.hint")}</p>
    </PhoneScreen>
  );
}
