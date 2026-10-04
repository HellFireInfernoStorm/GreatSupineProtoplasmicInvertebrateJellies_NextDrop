import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useIsDesktop } from "../../../lib/layout";
import { useSession } from "../../../lib/session";
import { formatDay, formatTime } from "../../../lib/time";
import { Banner, Button } from "../../../ui";
import { dateInstant } from "../dates";
import { Icon } from "../icons";
import { PhoneScreen } from "../StoreLayout";
import { useBoard } from "./useBoard";
import { alertsOf } from "./model";
import {
  AlertBanners,
  AlertsCard,
  Hero,
  HeroEmpty,
  LateOrLostSheet,
  NextOrderCard,
  NoSignalNote,
  OrdersCard,
} from "./parts";

function useGreeting(now: Date): string {
  const { t } = useTranslation("store/deliveries");
  const { user } = useSession();
  const hour = Number(formatTime(now).slice(0, 2));
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return t(`greeting.${part}`, { name: user.displayName.split(/\s+/)[0] });
}

/**
 * S2 My deliveries. Desktop: Figma `230:136`. Phone: `248:960`, with the silent-driver state of `491:1402` and the
 * next day's orders of `235:832`.
 */
export function DeliveriesPage() {
  const { t } = useTranslation("store/deliveries");
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const board = useBoard();
  const { now, today, nextDay, model, orders, run, later } = board;
  const [explaining, setExplaining] = useState(false);
  const alerts = alertsOf(orders);
  const notice = later.find((order) => order.status === "DEFERRED");
  const greeting = useGreeting(now);
  const todayText = formatDay(dateInstant(today));

  const hero = board.loading ? null : run ? (
    <Hero run={run} desktop={desktop} refreshing={board.refreshing} onRefresh={board.refresh} />
  ) : (
    <HeroEmpty waiting={orders.length > 0} />
  );
  const failed = board.failed && (
    <Banner
      tone="danger"
      message={t("loadFailed")}
      action={
        <Button variant="secondary" onClick={board.refresh}>
          {t("retry")}
        </Button>
      }
    />
  );
  const silentNote = run?.state === "nosignal" && <NoSignalNote onExplain={() => setExplaining(true)} />;
  const todayCard = (
    <OrdersCard
      title={t("orders.title")}
      aside={run ? t("orders.trip", { day: todayText, trip: run.trip.displayId }) : todayText}
      orders={orders}
      desktop={desktop}
      empty={t("orders.none")}
      hint={desktop ? t("orders.hint") : undefined}
    />
  );
  const laterCard = later.length > 0 && (
    <OrdersCard
      title={t("orders.titleOn", { day: formatDay(dateInstant(nextDay)) })}
      orders={later}
      desktop={false}
      action={
        notice && (
          <Button variant="secondary" className="w-full" onClick={() => void navigate(`/store/orders/${notice.id}`)}>
            {t("orders.deferralNotice")}
          </Button>
        )
      }
    />
  );
  const sheet = <LateOrLostSheet open={explaining} onClose={() => setExplaining(false)} />;

  if (!desktop) {
    return (
      <PhoneScreen nav title={t("title")} subtitle={`${greeting} · ${todayText}`}>
        {failed}
        {hero}
        {silentNote}
        <AlertBanners alerts={alerts} />
        {todayCard}
        {laterCard}
        <NextOrderCard model={model} desktop={false} />
        {sheet}
      </PhoneScreen>
    );
  }

  return (
    <main className="flex flex-col gap-6 p-8">
      <div className="flex items-end justify-between gap-6">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">
            {t("eyebrow", { day: todayText })}
          </p>
          <h1 className="mt-2 text-3xl leading-[1.25] font-bold tracking-[-0.01em]">{greeting}</h1>
          <p className="mt-2 text-sm text-muted">{t("intro", { count: orders.length })}</p>
        </div>
        <Button icon={<Icon name="plus" />} onClick={() => void navigate("/store/order")}>
          {t("placeOrder")}
        </Button>
      </div>
      {failed}
      <div className="grid grid-cols-[minmax(0,1fr)_412px] items-start gap-6">
        <div className="flex flex-col gap-6">
          {hero}
          {silentNote}
          {todayCard}
        </div>
        <div className="flex flex-col gap-6">
          <AlertsCard alerts={alerts} />
          {laterCard}
          <NextOrderCard model={model} desktop />
        </div>
      </div>
      {sheet}
    </main>
  );
}
