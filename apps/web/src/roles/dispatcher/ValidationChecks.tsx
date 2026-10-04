import type { ApiValidationResult } from "@nextdrop/contracts";
import { DEFAULT_RULES_CONFIG, type ViolationCode } from "@nextdrop/rules";
import { useTranslation } from "react-i18next";

const groups: readonly [string, readonly ViolationCode[]][] = [
  ["weight", ["WEIGHT_CAP_EXCEEDED"]],
  ["volume", ["VOLUME_CAP_EXCEEDED"]],
  ["temperature", ["REEFER_REQUIRED"]],
  ["access", ["VAN_REQUIRED"]],
  ["depotCheck", ["DEPOT_MISMATCH", "VEHICLE_UNAVAILABLE"]],
  ["brandDistrict", ["MIXED_BRAND", "MIXED_DISTRICT"]],
  ["timeBudget", ["TIME_BUDGET_EXCEEDED"]],
  ["windows", ["WINDOW_MISSED", "MALL_WINDOW_VIOLATION", "NON_OPERATING_DAY"]],
  ["tripLimit", ["TRIP_LIMIT_EXCEEDED"]],
  ["fuelCheck", ["FUEL_QUOTA_EXCEEDED", "LOW_FUEL_MARGIN"]],
  ["loadingState", ["ORDER_ALREADY_LOADED"]],
  ["repeatDeferral", ["REPEAT_DEFERRAL"]],
];
export function ValidationChecks({
  result,
  serverVerified = false,
  contextAvailable = false,
}: {
  result: ApiValidationResult;
  serverVerified?: boolean;
  contextAvailable?: boolean;
}) {
  const { t, i18n } = useTranslation("dispatcher/planning");
  const number = new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 3 });
  const hard = result.violations.filter((v) => v.severity === "HARD");
  return (
    <section className="dispatch-checks">
      <h3>{t("checks")}</h3>
      <p className={hard.length ? "dispatch-danger" : "dispatch-muted"}>
        {hard.length ? t("failCount", { count: hard.length }) : t("allPass")}
      </p>
      <ul>
        {groups.map(([key, codes]) => {
          const failures = result.violations.filter((v) => codes.includes(v.code));
          const pending =
            ["fuelCheck", "loadingState", "repeatDeferral"].includes(key) &&
            !serverVerified &&
            !contextAvailable &&
            failures.length === 0;
          return (
            <li
              key={key}
              data-check={
                failures.some((v) => v.severity === "HARD") ? "fail" : failures.length || pending ? "warn" : "pass"
              }
            >
              <span aria-hidden="true">{failures.length ? "!" : pending ? "…" : "✓"}</span>
              <span>
                {t(key, { count: DEFAULT_RULES_CONFIG.maxTripsPerVehicle })}
                {pending && <> · {t("pending")}</>}
                {failures.map((v, index) => {
                  const delta =
                    typeof v.params.actual === "number" && typeof v.params.limit === "number"
                      ? v.params.actual - v.params.limit
                      : null;
                  const divisor = key === "weight" || key === "volume" || key === "fuelCheck" ? 1000 : 1;
                  const unit =
                    key === "weight"
                      ? "kg"
                      : key === "volume"
                        ? "m3"
                        : key === "fuelCheck"
                          ? "L"
                          : key === "tripLimit"
                            ? "trips"
                            : "min";
                  return (
                    <small key={index}>
                      {t(`validator.${v.code}`)}
                      {v.tripRef && <> · {v.tripRef}</>}
                      {delta !== null && delta > 0 && (
                        <> · {t("over", { amount: number.format(delta / divisor), unit: t(`units.${unit}`) })}</>
                      )}
                    </small>
                  );
                })}
              </span>
            </li>
          );
        })}
      </ul>
      {result.violations
        .filter((v) => !groups.some(([, codes]) => codes.includes(v.code)))
        .map((v, i) => (
          <p key={i} className={v.severity === "HARD" ? "dispatch-danger" : "dispatch-warning"}>
            {t(`validator.${v.code}`)}
          </p>
        ))}
      <p className="dispatch-muted">{t(serverVerified ? "serverVerified" : "serverPending")}</p>
    </section>
  );
}
