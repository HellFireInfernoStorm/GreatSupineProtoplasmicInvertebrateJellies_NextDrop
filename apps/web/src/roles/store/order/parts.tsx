import { useTranslation } from "react-i18next";
import { formatDay, formatTime } from "../../../lib/time";
import { Banner, Button, ChilledPill, QuantityStepper } from "../../../ui";
import { dateInstant, dayMonth, weekdayShort } from "../dates";
import { Icon } from "../icons";
import { useCountdownText } from "./countdown";
import { draft, draftLineItems, productLabel, TEMPS, type DraftLine, type Product, type Temp } from "./draft";
import type { OrderModel } from "./useOrderModel";
import type { SubmitFailure } from "./useSubmitOrders";

// The pieces the place-order screens share, on desktop and on phone.

/** Desktop: the dark cutoff card with the live countdown (Figma `230:332`). */
export function CutoffHero({ model }: { model: OrderModel }) {
  const { t } = useTranslation("store/order");
  const left = useCountdownText(model.cutoffAtMs, model.nowMs);
  const next = model.options.find((option) => option.date > model.date && option.operating);
  return (
    <section className="flex items-center justify-between gap-6 rounded-2xl bg-panel px-7 py-6 text-on-panel">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.06em] text-on-panel-muted uppercase">
          {t("cutoff.eyebrow", {
            day: formatDay(dateInstant(model.date)),
            time: formatTime(new Date(model.cutoffAtMs)),
          })}
        </p>
        {next && <p className="mt-1.5 text-sm">{t("cutoff.after", { next: formatDay(dateInstant(next.date)) })}</p>}
      </div>
      <p className="shrink-0 text-right">
        <strong className="block text-3xl leading-[1.2] font-bold">{left}</strong>
        <span className="text-xs text-on-panel-muted">{t("cutoff.left")}</span>
      </p>
    </section>
  );
}

/** Phone: the compact cutoff banner (Figma `248:1062`). */
export function CutoffBanner({ model }: { model: OrderModel }) {
  const { t } = useTranslation("store/order");
  const left = useCountdownText(model.cutoffAtMs, model.nowMs);
  return (
    <section className="flex items-center gap-3 rounded-2xl bg-panel px-4 py-3 text-on-panel">
      <Icon name="clock" className="size-6" />
      <p>
        <span className="block text-[11px] font-semibold tracking-[0.06em] text-on-panel-muted uppercase">
          {t("cutoff.banner", {
            day: formatDay(dateInstant(model.date)),
            time: formatTime(new Date(model.cutoffAtMs)),
          })}
        </span>
        <strong className="text-base font-semibold">{t("cutoff.bannerLeft", { left })}</strong>
      </p>
    </section>
  );
}

/** The delivery dates to choose from. A day with no deliveries, or one whose cutoff has passed, cannot be picked. */
export function DateChips({ model }: { model: OrderModel }) {
  const { t } = useTranslation("store/order");
  return (
    <div role="radiogroup" aria-label={t("date.label")} className="flex gap-2 lg:gap-3">
      {model.options.map((option) => {
        const selected = option.date === model.date;
        const disabled = !option.operating || option.closed;
        return (
          <button
            key={option.date}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => draft.setDate(option.date)}
            className={`flex h-14 min-w-0 flex-1 flex-col items-center justify-center rounded-xl border text-sm lg:h-16 ${
              selected
                ? "border-primary bg-primary font-semibold text-on-primary"
                : disabled
                  ? "border-border bg-surface-2 text-faint"
                  : "border-border bg-surface font-semibold text-text"
            }`}
          >
            <span>{weekdayShort(option.date)}</span>
            <span
              className={`text-xs font-normal ${selected ? "text-on-primary" : disabled ? "text-faint" : "text-muted"}`}
            >
              {!option.operating ? t("date.none") : option.closed ? t("date.closed") : dayMonth(option.date)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Dry or Chilled. Each tab is one order. `short` uses the phone wording. */
export function TempTabs({
  tab,
  onChange,
  counts,
  short = false,
}: {
  tab: Temp;
  onChange: (tab: Temp) => void;
  counts: Record<Temp, number>;
  short?: boolean;
}) {
  const { t } = useTranslation("store/order");
  return (
    <div role="tablist" aria-label={t("items.tabs")} className="flex gap-1 rounded-xl bg-surface-2 p-1">
      {TEMPS.map((temp) => (
        <button
          key={temp}
          type="button"
          role="tab"
          aria-selected={temp === tab}
          onClick={() => onChange(temp)}
          className={`flex h-9 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-xs font-semibold whitespace-nowrap ${
            temp === tab ? "bg-primary text-on-primary" : "text-muted"
          }`}
        >
          <Icon name={temp === "chilled" ? "snow" : "bag"} className="size-4" />
          {t(`items.${short ? "tabShort" : "tab"}.${temp}`, { count: counts[temp] })}
        </button>
      ))}
    </div>
  );
}

/** The quantity control of one product. The kit's stepper shows its label; here the product name sits beside it. */
export function ProductStepper({ product, qty }: { product: Product; qty: number }) {
  const { t } = useTranslation("store/order");
  return (
    <div className="shrink-0 [&_.nd-field]:gap-0">
      <QuantityStepper
        label={<span className="sr-only">{t("items.quantity", { product: productLabel(product) })}</span>}
        value={qty}
        min={0}
        max={9999}
        onChange={(value) => draft.setQty(product.id, value)}
      />
    </div>
  );
}

/** One line of the draft on the place-order screen. */
export function ItemRow({ line, last, removable }: { line: DraftLine; last: string; removable: boolean }) {
  const { t } = useTranslation("store/order");
  return (
    <li className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-3 lg:gap-4 lg:px-4">
      <span className="hidden size-11 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted lg:flex">
        <Icon name="bag" />
      </span>
      <p className="min-w-0 flex-1">
        <span className="block text-sm font-semibold break-words">{productLabel(line.product)}</span>
        <span className="text-xs text-muted">{last}</span>
      </p>
      <ProductStepper product={line.product} qty={line.qty} />
      {removable && (
        <button
          type="button"
          aria-label={t("items.remove", { product: productLabel(line.product) })}
          onClick={() => draft.setQty(line.product.id, 0)}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted hover:text-danger"
        >
          <Icon name="trash" />
        </button>
      )}
    </li>
  );
}

/** The lines of one order, as read-only text: used by the summary, the review and the placed screens. */
export function LineList({
  lines,
}: {
  lines: readonly { name: string; unitLabel: string; qty: number; key: string }[];
}) {
  return (
    <ul className="flex flex-col gap-2.5">
      {lines.map((line) => (
        <li key={line.key} className="flex items-baseline justify-between gap-3 text-sm">
          <span>{productLabel(line)}</span>
          <strong className="font-semibold whitespace-nowrap">{line.qty} ×</strong>
        </li>
      ))}
    </ul>
  );
}

/** Desktop: the order summary card with the screen's primary action. */
export function OrderSummary({ model, action }: { model: OrderModel; action: React.ReactNode }) {
  const { t } = useTranslation("store/order");
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold">{t("summary.title")}</h2>
      <dl className="flex flex-col gap-2.5 border-b border-border pb-4 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-xs text-muted">{t("summary.outlet")}</dt>
          <dd className="font-semibold">
            {model.outlet ? `${model.outlet.displayId} · ${model.outlet.district}` : ""}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-xs text-muted">{t("summary.date")}</dt>
          <dd className="font-semibold">{formatDay(dateInstant(model.date))}</dd>
        </div>
      </dl>
      {model.orders.length === 0 && <p className="text-sm text-muted">{t("summary.none")}</p>}
      {model.orders.map((order) => (
        <div key={order.temp} className="flex flex-col gap-3 border-b border-border pb-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold">{t(`summary.order.${order.temp}`)}</h3>
            {order.temp === "chilled" ? (
              <ChilledPill />
            ) : (
              <span className="rounded-full bg-neutral-bg px-2.5 py-1 text-[11px] font-semibold text-neutral">
                {t("summary.items", { count: order.lines.length })}
              </span>
            )}
          </div>
          <LineList lines={draftLineItems(order.lines)} />
        </div>
      ))}
      {model.orders.length > 0 && (
        <div className="flex justify-between gap-3 text-sm">
          <span className="text-xs text-muted">{t("summary.orders")}</span>
          <strong className="font-semibold">{t("summary.ordersValue", { count: model.orders.length })}</strong>
        </div>
      )}
      {action}
      <p className="text-xs leading-[1.5] text-muted">{t("summary.hint")}</p>
    </section>
  );
}

/** Why a submission failed. No connection is amber, never red (apps/web/AGENTS.md). */
export function SubmitFailureBanner({ failure }: { failure: SubmitFailure | null }) {
  const { t } = useTranslation("store/order");
  if (!failure) return null;
  return (
    <Banner
      urgent
      tone={failure.kind === "network" ? "warn" : "danger"}
      message={t(`errors.${failure.kind}`)}
      detail={failure.placedBefore > 0 ? t("errors.partial", { count: failure.placedBefore }) : undefined}
    />
  );
}

/** The brand ordering notice for the chosen date. A notice only: it never blocks the order (ADR 0010). */
export function GuidanceNotice({ model }: { model: OrderModel }) {
  const { t } = useTranslation("store/order");
  if (!model.guidanceKey) return null;
  return <Banner tone="info" message={t(model.guidanceKey)} />;
}

/** Shown while the outlet and catalogue load, or when they could not be loaded. */
export function CatalogueState({ model }: { model: OrderModel }) {
  const { t } = useTranslation("store/order");
  const { t: common } = useTranslation("shared/common");
  if (model.failed) {
    return (
      <Banner
        urgent
        tone="warn"
        message={t("errors.load")}
        action={
          <Button variant="secondary" size="sm" onClick={model.retry}>
            {t("errors.retry")}
          </Button>
        }
      />
    );
  }
  return <p className="text-sm text-muted">{common("status.loading")}</p>;
}
