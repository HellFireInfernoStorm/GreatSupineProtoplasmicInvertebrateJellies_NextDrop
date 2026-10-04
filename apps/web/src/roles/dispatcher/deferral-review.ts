import type { ApiDto } from "@nextdrop/contracts";
import { DEFAULT_RULES_CONFIG, deferralNoteRequired, explainDeferral } from "@nextdrop/rules";
import { toPlan, validationContext, type BrowserReference, type DraftData } from "./planning";

/** Wire/reference adaptation only: classification and consequences belong to shared rules. */
export function buildDeferralReview(
  data: DraftData,
  day: ApiDto<"dayResponse">,
  reference: BrowserReference,
  unavailable: ReadonlySet<string>,
  breakdown: ReadonlySet<string>,
) {
  const plan = toPlan(data, day.queue, day.date, reference);
  const assigned = new Set(data.trips.flatMap((trip) => trip.orderIds));
  const chosen = new Map(data.deferrals.map((row) => [row.orderId, row]));
  const service = new Map(day.planningContext.outletService.map((row) => [row.outletId, row]));
  const ctx = validationContext(day.planningContext, reference);
  return day.queue
    .filter((order) => !assigned.has(order.id))
    .map((order) => {
      const state = service.get(order.outletId);
      const explanation = explainDeferral(
        {
          ...plan.orders!.find((row) => row.id === order.id)!,
          brand: order.brand,
          requestedDate: order.requestedDate,
          deferredCount: order.deferredCount,
          deferredYesterday: state?.deferredLastRun ?? false,
          daysSinceLastServed: state?.daysSinceLastServed ?? 0,
        },
        plan,
        reference.ref,
        DEFAULT_RULES_CONFIG,
        {
          unavailableVehicleIds: unavailable,
          breakdownVehicleIds: breakdown,
          fuelUsedThisWeekMl: ctx.fuelUsedThisWeekMl,
        },
      );
      const reasonCode = chosen.get(order.id)?.reasonCode ?? explanation.reasonCode;
      const note = chosen.get(order.id)?.note ?? "";
      const repeat = state?.deferredLastRun ?? false;
      return {
        order,
        explanation,
        reasonCode,
        note,
        repeat,
        needsNote: deferralNoteRequired({ reasonCode, deferredLastRun: repeat }),
      };
    })
    .sort(
      (a, b) =>
        Number(b.repeat) - Number(a.repeat) ||
        b.explanation.daysUnserved - a.explanation.daysUnserved ||
        b.explanation.consecutiveDeferrals - a.explanation.consecutiveDeferrals ||
        a.order.displayId.localeCompare(b.order.displayId),
    );
}
export type DeferralReviewRow = ReturnType<typeof buildDeferralReview>[number];

/** Include every unassigned queue order, including manual-only drafts with no explanation rows yet. */
export function reviewDraft(data: DraftData, rows: readonly DeferralReviewRow[]): DraftData {
  return {
    ...data,
    unassignedOrderIds: rows.map((row) => row.order.id),
    deferrals: rows.map((row) => ({ orderId: row.order.id, reasonCode: row.reasonCode, note: row.note })),
  };
}
