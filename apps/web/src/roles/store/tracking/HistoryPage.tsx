import { useTranslation } from "react-i18next";
import { useIsDesktop } from "../../../lib/layout";
import { Banner, Button } from "../../../ui";
import { useOrderHistory, useOutlet } from "../data";
import { PhoneScreen } from "../StoreLayout";
import { OrdersList, OrdersTable, type Row } from "./TrackingPage";

/** Order history: the outlet's orders, newest first. Desktop: Figma `233:567`. Phone: `250:1298`. */
export function HistoryPage() {
  const { t } = useTranslation("store/tracking");
  const desktop = useIsDesktop();
  const outlet = useOutlet().data;
  const history = useOrderHistory();
  // The list carries no trip, so a row shows the order's own dates and status; its timeline has the rest.
  const rows: Row[] = [...(history.data ?? [])]
    .sort((a, b) => b.currentDate.localeCompare(a.currentDate) || b.placedAt.localeCompare(a.placedAt))
    .map((order) => ({ order, trip: null, stop: null }));
  const state = history.isError ? (
    <Banner
      tone="danger"
      message={t("history.failed")}
      action={
        <Button variant="secondary" onClick={() => void history.refetch()}>
          {t("history.retry")}
        </Button>
      }
    />
  ) : !history.isPending && rows.length === 0 ? (
    <p className="text-sm text-muted">{t("history.empty")}</p>
  ) : null;

  if (!desktop) {
    return (
      <PhoneScreen nav title={t("history.title")} subtitle={outlet?.name}>
        {state}
        {rows.length > 0 && <OrdersList rows={rows} />}
      </PhoneScreen>
    );
  }
  return (
    <main className="flex flex-col gap-6 p-8">
      <div>
        {outlet && (
          <p className="text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">
            {t("history.eyebrow", { outlet: outlet.displayId })}
          </p>
        )}
        <h1 className="mt-2 text-3xl leading-[1.25] font-bold tracking-[-0.01em]">{t("history.title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("history.intro")}</p>
      </div>
      {state}
      {rows.length > 0 && <OrdersTable rows={rows} />}
    </main>
  );
}
