import type { ApiDto } from "@nextdrop/contracts";
import { DEFAULT_RULES_CONFIG } from "@nextdrop/rules";
import { NO_SIGNAL_AFTER_MIN } from "../orders";
import { reasonLists } from "../reference";

/** `BEHIND_GRACE_MIN` (spec/assumptions.md): past ETA by this much, a run is behind. */
export const LATE_GRACE_MIN = 15;

export function snapshotConfig(): ApiDto<"snapshotConfig"> {
  return {
    rules: { ...DEFAULT_RULES_CONFIG, priorityOrder: [...DEFAULT_RULES_CONFIG.priorityOrder] },
    reasons: reasonLists(),
    noSignalAfterMin: NO_SIGNAL_AFTER_MIN,
    lateGraceMin: LATE_GRACE_MIN,
  };
}
