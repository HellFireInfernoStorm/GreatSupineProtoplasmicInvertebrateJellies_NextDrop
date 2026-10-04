import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { parseQuantity, nextQuantity } from "./quantity";
import "./interaction.css";
export interface QuantityStepperProps {
  label: ReactNode;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}
export function QuantityStepper({
  label,
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
}: QuantityStepperProps) {
  const { t } = useTranslation("shared/ui");
  const id = useId();
  const [edit, setEdit] = useState<{ base: number; raw: string } | null>(null);
  const raw = edit?.base === value ? edit.raw : String(value);
  const parsed = parseQuantity(raw, min, max);
  const change = (delta: number) => {
    const next = nextQuantity(value, delta, min, max);
    setEdit(null);
    if (next !== null && next !== value) onChange(next);
  };
  const validStep = Number.isSafeInteger(step) && step > 0;
  return (
    <div className="nd-field">
      <label htmlFor={id}>{label}</label>
      <div className="nd-stepper">
        <Button
          variant="ghost"
          aria-label={t("quantityDecrease")}
          disabled={!validStep || !Number.isSafeInteger(value) || value <= min}
          onClick={() => change(-step)}
        >
          <span className="nd-stepper-icon nd-symbol nd-symbol-minus" aria-hidden="true" />
        </Button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          role="spinbutton"
          aria-valuenow={Number.isSafeInteger(value) ? value : undefined}
          aria-valuemin={Number.isFinite(min) ? min : undefined}
          aria-valuemax={Number.isFinite(max) ? max : undefined}
          aria-invalid={parsed === null}
          aria-describedby={parsed === null ? `${id}-error` : undefined}
          value={raw}
          onChange={(event) => {
            const next = parseQuantity(event.target.value, min, max);
            setEdit({ base: next ?? value, raw: event.target.value });
            if (next !== null && next !== value) onChange(next);
          }}
          onBlur={() => setEdit(null)}
          onKeyDown={(event) => {
            if (validStep && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
              event.preventDefault();
              change(event.key === "ArrowUp" ? step : -step);
            }
          }}
        />
        <Button
          variant="ghost"
          aria-label={t("quantityIncrease")}
          disabled={!validStep || !Number.isSafeInteger(value) || value >= max}
          onClick={() => change(step)}
        >
          <span className="nd-stepper-icon nd-symbol nd-symbol-plus" aria-hidden="true" />
        </Button>
      </div>
      {parsed === null && (
        <span className="nd-field-error" id={`${id}-error`}>
          {t("quantityInvalid")}
        </span>
      )}
    </div>
  );
}
