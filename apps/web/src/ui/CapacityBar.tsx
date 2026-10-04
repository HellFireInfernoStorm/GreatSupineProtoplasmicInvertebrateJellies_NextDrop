import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Tone } from "./status";
import "./display.css";
import { capacityRatio } from "./capacity";

export interface CapacityBarProps {
  label: ReactNode;
  used: number;
  capacity?: number | null;
  unit: string;
  tone?: "ok" | "info";
  presentation?: "default" | "summary";
}
export function CapacityBar({
  label,
  used,
  capacity,
  unit,
  tone = "info",
  presentation = "default",
}: CapacityBarProps) {
  const { t, i18n } = useTranslation("shared/ui");
  const id = useId();
  const ratio = capacityRatio(used, capacity);
  const displayTone: Tone =
    ratio === null ? "neutral" : used > (capacity as number) ? "danger" : ratio >= 0.9 ? "warn" : tone;
  // Presentation precision removes floating-point noise; raw values still drive validation and fill.
  const number = new Intl.NumberFormat(i18n.resolvedLanguage, { maximumSignificantDigits: 12 });
  const value =
    ratio === null
      ? t("capacity.unavailable")
      : t("capacity.value", { used: number.format(used), capacity: number.format(capacity as number), unit });
  return (
    <div className="nd-capacity" data-tone={displayTone} data-used={used} data-presentation={presentation}>
      <div className="nd-capacity-header">
        <span id={id}>{label}</span>
        <strong>{presentation === "summary" ? `${number.format(used)} ${unit}` : value}</strong>
      </div>
      {ratio !== null && (
        <div
          className="nd-capacity-track"
          role="meter"
          aria-labelledby={id}
          aria-valuemin={0}
          aria-valuemax={capacity as number}
          aria-valuenow={Math.min(used, capacity as number)}
          aria-valuetext={value}
        >
          <span className="nd-capacity-fill" style={{ width: `${ratio * 100}%` }} />
        </div>
      )}
      {presentation === "summary" && <small>{value}</small>}
    </div>
  );
}
