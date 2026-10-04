import { localDate, type ApiDto } from "@nextdrop/contracts";
export function notificationLink(
  entity: ApiDto<"notification">["entityRef"],
  kind = "",
  date?: string,
  depot?: string,
): string | null {
  const id = encodeURIComponent(entity.id);
  const scope = depot ? `&depot=${encodeURIComponent(depot)}` : "";
  switch (entity.type.toLowerCase()) {
    case "trip":
      return `/dispatch/runs?trip=${id}`;
    case "vehicle":
      return `/dispatch/fleet?vehicle=${id}`;
    case "order":
      if (kind === "deferral_notice" || kind === "order_deferred") return `/dispatch/defer?order=${id}`;
      if (["short_reported", "damaged_reported", "problem_reported", "dispute_opened", "stop_failed"].includes(kind))
        return `/dispatch/runs?order=${id}`;
      return `/dispatch/queue?order=${id}`;
    case "planning_day":
    case "planningday":
    case "day":
      if (localDate.safeParse(date).success) return `/dispatch/plan?day=${encodeURIComponent(date!)}${scope}`;
      if (localDate.safeParse(entity.id).success) return `/dispatch/plan?day=${id}${scope}`;
      return `/dispatch/plan?planningDay=${id}${scope}`;
    case "conflict":
    case "issue":
      return `/dispatch/runs?exception=${id}`;
    default:
      return null;
  }
}
