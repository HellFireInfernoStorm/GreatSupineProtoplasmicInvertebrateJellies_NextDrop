import { useTranslation } from "react-i18next";
import { timeLeft, weekdayShort } from "../dates";
import type { Product } from "./draft";
import type { OrderModel } from "./useOrderModel";

/** The time left to a cutoff as text: "2 h 48 min", "48 min" or "less than 1 min". */
export function useCountdownText(cutoffAtMs: number, nowMs: number): string {
  const { t } = useTranslation("store/order");
  const { hours, minutes } = timeLeft(cutoffAtMs, nowMs);
  if (hours > 0) return t("countdown.hm", { hours, minutes });
  return minutes > 0 ? t("countdown.m", { minutes }) : t("countdown.soon");
}

/** For a product, what the outlet took a week earlier: "Last Wed: 10". */
export function useLastWeekText(model: OrderModel) {
  const { t } = useTranslation("store/order");
  const weekday = weekdayShort(model.date);
  return (product: Product) => {
    const qty = model.lastQty[product.id];
    return qty ? t("items.last", { weekday, qty }) : t("items.lastNone", { weekday });
  };
}
