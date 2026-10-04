import { PROBLEM_KINDS, LOAD_DAMAGED_REASON_CODES, type ApiDto } from "@nextdrop/contracts";
import { REASON_CODES } from "@nextdrop/rules";

/**
 * Loader short-sheet and driver failed-stop reason chips (ADR 0034). The design draws chips but does not list them;
 * these are the build's codes, each with an i18n key `<list>.<code>`.
 */
export const LOAD_SHORT_REASONS = ["STOCK_SHORT", "DAMAGED_AT_DOCK", "PICKING_ERROR", "OTHER"] as const;
export const STOP_OUTCOME_REASONS = [
  "STORE_CLOSED",
  "REFUSED_BY_STORE",
  "NO_ACCESS",
  "VEHICLE_BREAKDOWN",
  "OTHER",
] as const;

/** Loader damage-sheet chips (ADR 0042). Re-export so API callers share the contracts catalogue. */
export const LOAD_DAMAGED_REASONS = LOAD_DAMAGED_REASON_CODES;

const list = <C extends string>(group: string, codes: readonly C[]) =>
  codes.map((code) => ({ code, message_key: `${group}.${code}` }));

/** The reason lists shared by `/ref/reasons` and the field snapshot. */
export function reasonLists(): ApiDto<"reasonsResponse"> {
  return {
    deferral: list("deferral", REASON_CODES),
    problems: list("problems", PROBLEM_KINDS),
    loadShort: list("loadShort", LOAD_SHORT_REASONS),
    loadDamaged: list("loadDamaged", LOAD_DAMAGED_REASONS),
    stopOutcome: list("stopOutcome", STOP_OUTCOME_REASONS),
  };
}
