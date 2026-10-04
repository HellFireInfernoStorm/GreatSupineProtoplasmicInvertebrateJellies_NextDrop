import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import { useIsDesktop } from "../../../lib/layout";
import { formatDay } from "../../../lib/time";
import { Button } from "../../../ui";
import { dateInstant, weekdayShort } from "../dates";
import { Icon } from "../icons";
import { PhoneScreen } from "../StoreLayout";
import { draft, productLabel, TEMPS, type Product, type Temp } from "./draft";
import { CatalogueState, OrderSummary, ProductStepper, TempTabs } from "./parts";
import { useOrderModel, type OrderModel } from "./useOrderModel";

const matches = (product: Product, search: string) =>
  `${product.name} ${product.unitLabel} ${product.sku}`.toLowerCase().includes(search.trim().toLowerCase());

function Search({ value, onChange, brand }: { value: string; onChange: (value: string) => void; brand: string }) {
  const { t } = useTranslation("store/order");
  return (
    <label className="flex h-11 shrink-0 items-center gap-3 rounded-xl bg-surface-2 px-4 text-faint lg:flex-1">
      <Icon name="search" />
      <span className="sr-only">{t("catalogue.search", { brand })}</span>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("catalogue.search", { brand })}
        className="h-full min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-faint"
      />
    </label>
  );
}

function ProductList({
  model,
  tab,
  search,
  desktop,
}: {
  model: OrderModel;
  tab: Temp;
  search: string;
  desktop: boolean;
}) {
  const { t } = useTranslation("store/order");
  const weekday = weekdayShort(model.date);
  const products = model.products.filter((product) => product.tempRequirement === tab && matches(product, search));
  if (products.length === 0) return <p className="py-2 text-sm text-muted">{t("catalogue.none")}</p>;
  return (
    <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
      {products.map((product) => {
        const qty = model.qty[product.id] ?? 0;
        const last = model.lastQty[product.id];
        return (
          <li key={product.id} className="flex items-center gap-3 px-3 py-3 lg:gap-4 lg:px-5">
            <span
              className={`flex size-10 shrink-0 items-center justify-center rounded-lg lg:size-11 ${
                qty > 0 ? "bg-ok-bg text-ok" : "bg-surface-2 text-muted"
              }`}
            >
              <Icon name={qty > 0 ? "checkCircle" : "bag"} />
            </span>
            <p className="min-w-0 flex-1">
              <span className="block text-sm font-semibold break-words">{productLabel(product)}</span>
              <span className="text-xs text-muted">
                {last
                  ? t("catalogue.sku", { sku: product.sku, weekday, qty: last })
                  : t("catalogue.skuNone", { sku: product.sku, weekday })}
              </span>
            </p>
            <ProductStepper product={product} qty={qty} />
            {desktop && (
              <Button
                variant={qty > 0 ? "secondary" : "primary"}
                className="w-24 shrink-0"
                icon={<Icon name={qty > 0 ? "checkCircle" : "plus"} />}
                disabled={qty > 0}
                // Start from what the outlet took last week, or one.
                onClick={() => draft.setQty(product.id, last ?? 1)}
              >
                {t(qty > 0 ? "catalogue.added" : "catalogue.add")}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The catalogue for the signed-in outlet's brand. Desktop: the Products screen, Figma `232:326`.
 * Phone: Add items, `248:1168`. One screen for every brand: the server returns only the outlet's own products.
 */
export function ItemsPage() {
  const { t } = useTranslation("store/order");
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const model = useOrderModel();
  const [tab, setTab] = useState<Temp>(TEMPS.find((temp) => temp === params.get("order")) ?? "ambient");
  const [search, setSearch] = useState("");
  const brand = model.outlet?.brand ?? "";
  const counts = Object.fromEntries(
    TEMPS.map((temp) => [temp, model.products.filter((p) => p.tempRequirement === temp).length]),
  ) as Record<Temp, number>;
  const day = formatDay(dateInstant(model.date));
  const ready = !model.loading && !model.failed;

  if (!desktop) {
    const orderName = t(`summary.order.${tab}`).toLowerCase();
    return (
      <PhoneScreen
        title={t("catalogue.phoneTitle")}
        subtitle={t("catalogue.phoneSubtitle", { day, order: t(`summary.order.${tab}`) })}
        back={{ to: "/store/order", label: t("catalogue.back") }}
        footer={
          <Button
            size="lg"
            className="w-full"
            icon={<Icon name="checkCircle" />}
            onClick={() => void navigate("/store/order")}
          >
            {t("catalogue.done", { count: model.lines[tab].length, order: orderName })}
          </Button>
        }
      >
        <Search value={search} onChange={setSearch} brand={brand} />
        <TempTabs tab={tab} onChange={setTab} counts={counts} short />
        {ready ? (
          <ProductList model={model} tab={tab} search={search} desktop={false} />
        ) : (
          <CatalogueState model={model} />
        )}
      </PhoneScreen>
    );
  }

  return (
    <main className="flex flex-col gap-6 p-8">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">
          {t("catalogue.eyebrow", { brand: model.outlet?.name ?? "" })}
        </p>
        <h1 className="mt-2 text-3xl leading-[1.25] font-bold tracking-[-0.01em]">{t("catalogue.title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("catalogue.intro", { day, brand })}</p>
      </div>
      {/* Two columns only where both fit: beside the sidebar that takes 1280 px. Narrower, the summary goes below. */}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_392px]">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <Search value={search} onChange={setSearch} brand={brand} />
            <TempTabs tab={tab} onChange={setTab} counts={counts} short />
          </div>
          {ready ? <ProductList model={model} tab={tab} search={search} desktop /> : <CatalogueState model={model} />}
        </div>
        <OrderSummary
          model={model}
          action={
            <Button
              size="lg"
              className="w-full"
              icon={<Icon name="chevronRight" />}
              disabled={model.orders.length === 0}
              onClick={() => void navigate("/store/order")}
            >
              {t("review.desktop")}
            </Button>
          }
        />
      </div>
    </main>
  );
}
