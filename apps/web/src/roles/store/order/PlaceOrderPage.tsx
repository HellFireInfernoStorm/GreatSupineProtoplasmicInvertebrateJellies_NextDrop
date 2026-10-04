import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { useIsDesktop } from "../../../lib/layout";
import { Button } from "../../../ui";
import { weekdayLong } from "../dates";
import { Icon } from "../icons";
import { PhoneScreen } from "../StoreLayout";
import { draft, type Temp } from "./draft";
import {
  CatalogueState,
  CutoffBanner,
  CutoffHero,
  DateChips,
  GuidanceNotice,
  ItemRow,
  OrderSummary,
  SubmitFailureBanner,
  TempTabs,
} from "./parts";
import { useLastWeekText } from "./countdown";
import { PlacedDialog } from "./Placed";
import { useOrderModel, type OrderModel } from "./useOrderModel";
import { useSubmitOrders } from "./useSubmitOrders";

const hasLastWeek = (model: OrderModel) => Object.keys(model.lastQty).length > 0;

function RepeatButton({ model, className = "" }: { model: OrderModel; className?: string }) {
  const { t } = useTranslation("store/order");
  return (
    <Button
      variant="secondary"
      className={className}
      icon={<Icon name="repeat" />}
      disabled={!hasLastWeek(model)}
      onClick={() => draft.fill(model.lastQty, model.products)}
    >
      {t("repeat", { weekday: weekdayLong(model.date) })}
    </Button>
  );
}

function Items({ model, tab, removable }: { model: OrderModel; tab: Temp; removable: boolean }) {
  const { t } = useTranslation("store/order");
  const last = useLastWeekText(model);
  const lines = model.lines[tab];
  if (lines.length === 0) return <p className="py-2 text-sm text-muted">{t(`items.empty.${tab}`)}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {lines.map((line) => (
        <ItemRow key={line.product.id} line={line} last={last(line.product)} removable={removable} />
      ))}
    </ul>
  );
}

/**
 * S1 Place order. Desktop: Figma `230:332` (cutoff card, delivery date, items, order summary with Submit).
 * Phone: `248:1062` (cutoff banner, date chips, items, then Review).
 */
export function PlaceOrderPage() {
  const { t } = useTranslation("store/order");
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const model = useOrderModel();
  const [tab, setTab] = useState<Temp>("ambient");
  const { pending, failure, submit } = useSubmitOrders();
  const counts = { ambient: model.lines.ambient.length, chilled: model.lines.chilled.length };
  const ready = !model.loading && !model.failed;

  if (!desktop) {
    return (
      <PhoneScreen
        nav
        title={t("title")}
        subtitle={model.outlet ? `${model.outlet.name} · ${model.outlet.displayId}` : undefined}
        footer={
          <Button
            size="lg"
            className="w-full"
            icon={<Icon name="chevronRight" />}
            disabled={model.orders.length === 0}
            onClick={() => void navigate("/store/order/review")}
          >
            {t("review.button", {
              count: model.orders.length,
              units: t("summary.units", { count: model.units }),
            })}
          </Button>
        }
      >
        <CutoffBanner model={model} />
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold">{t("date.label")}</h2>
          <DateChips model={model} />
          <p className="text-xs text-muted">{t("date.hint")}</p>
        </div>
        <GuidanceNotice model={model} />
        {ready ? (
          <>
            <RepeatButton model={model} className="w-full" />
            <TempTabs tab={tab} onChange={setTab} counts={counts} short />
            <Items model={model} tab={tab} removable={false} />
            <Link
              to={`/store/order/items?order=${tab}`}
              className="flex h-11 items-center justify-center gap-2 text-sm font-semibold"
            >
              <Icon name="plus" />
              {t("items.addPhone")}
            </Link>
          </>
        ) : (
          <CatalogueState model={model} />
        )}
      </PhoneScreen>
    );
  }

  return (
    <main className="flex flex-col gap-6 p-8">
      <div className="flex items-end justify-between gap-6">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">
            {t("eyebrow", { outlet: model.outlet ? `${model.outlet.displayId} ${model.outlet.district}` : "" })}
          </p>
          <h1 className="mt-2 text-3xl leading-[1.25] font-bold tracking-[-0.01em]">{t("title")}</h1>
          <p className="mt-2 text-sm text-muted">{t("intro")}</p>
        </div>
        {ready && <RepeatButton model={model} />}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_392px] items-start gap-6">
        <div className="flex flex-col gap-5">
          <CutoffHero model={model} />
          <GuidanceNotice model={model} />
          <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6">
            <h2 className="text-lg font-semibold">{t("date.title")}</h2>
            <DateChips model={model} />
            <p className="text-xs text-muted">{t("date.hint")}</p>
          </section>
          <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold">{t("items.title")}</h2>
              <TempTabs tab={tab} onChange={setTab} counts={counts} />
            </div>
            {ready ? <Items model={model} tab={tab} removable /> : <CatalogueState model={model} />}
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                icon={<Icon name="plus" />}
                onClick={() => void navigate(`/store/order/items?order=${tab}`)}
              >
                {t("items.add")}
              </Button>
              <p className="text-xs text-muted">{t("items.separate")}</p>
            </div>
          </section>
        </div>
        <div className="flex flex-col gap-4">
          <SubmitFailureBanner failure={failure} />
          <OrderSummary
            model={model}
            action={
              <Button
                size="lg"
                className="w-full"
                icon={<Icon name="send" />}
                loading={pending}
                disabled={model.orders.length === 0}
                onClick={() => void submit(model.date, model.orders)}
              >
                {pending
                  ? t("submitting")
                  : model.orders.length === 0
                    ? t("submitNone")
                    : t("submit", { count: model.orders.length })}
              </Button>
            }
          />
        </div>
      </div>
      <PlacedDialog />
    </main>
  );
}
