import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { createHoldController } from "./hold";
import { Modal } from "./Overlay";
import { Button } from "./Button";
import "./display.css";
import "./interaction.css";
export interface HoldToConfirmProps {
  children: ReactNode;
  hint?: ReactNode;
  onConfirm: () => void;
  disabled?: boolean;
}
export function HoldToConfirm({ children, hint, onConfirm, disabled = false }: HoldToConfirmProps) {
  const { t } = useTranslation("shared/ui");
  const id = useId();
  const callback = useRef(onConfirm);
  useEffect(() => {
    callback.current = onConfirm;
  }, [onConfirm]);
  const controller = useRef<ReturnType<typeof createHoldController> | null>(null);
  const source = useRef<string | null>(null);
  const [holding, setHolding] = useState(false);
  const [accessibleConfirm, setAccessibleConfirm] = useState(false);
  const [previousDisabled, setPreviousDisabled] = useState(disabled);
  if (previousDisabled !== disabled) {
    setPreviousDisabled(disabled);
    if (disabled) {
      setHolding(false);
      setAccessibleConfirm(false);
    }
  }
  const cancel = () => {
    controller.current?.cancel();
    source.current = null;
    setHolding(false);
  };
  useEffect(() => {
    controller.current = createHoldController(() => {
      setHolding(false);
      callback.current();
    });
    const stop = () => {
      controller.current?.cancel();
      source.current = null;
      setHolding(false);
    };
    const visibility = () => {
      if (document.hidden) stop();
    };
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      controller.current?.dispose();
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (disabled) {
      controller.current?.cancel();
      source.current = null;
    }
  }, [disabled]);
  const start = (input: string) => {
    if (disabled || source.current !== null) return;
    source.current = input;
    setHolding(true);
    controller.current?.start();
  };
  return (
    <>
      <button
        type="button"
        className="nd-hold"
        disabled={disabled}
        data-holding={holding && !disabled}
        aria-describedby={id}
        onPointerDown={(event) => {
          if (event.button !== 0 || source.current !== null || disabled) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          start(`pointer:${event.pointerId}`);
        }}
        onPointerUp={(event) => {
          if (source.current === `pointer:${event.pointerId}`) cancel();
        }}
        onPointerMove={(event) => {
          if (source.current !== `pointer:${event.pointerId}`) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            cancel();
        }}
        onPointerCancel={(event) => {
          if (source.current === `pointer:${event.pointerId}`) cancel();
        }}
        onLostPointerCapture={(event) => {
          if (source.current === `pointer:${event.pointerId}`) cancel();
        }}
        onBlur={cancel}
        onClick={(event) => {
          // Assistive activation has no sustained pointer/key. Require a second, explicit action.
          if (event.detail === 0 && source.current === null && !disabled) setAccessibleConfirm(true);
        }}
        onKeyDown={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            if (!event.repeat) start(event.key);
          }
        }}
        onKeyUp={(event) => {
          if (source.current === event.key) {
            event.preventDefault();
            cancel();
          }
        }}
      >
        <span className="nd-hold-icon nd-symbol nd-symbol-hold-check" aria-hidden="true" />
        <span className="nd-hold-copy">
          <strong>{children}</strong>
          <span id={id}>{hint ?? t("holdHint")}</span>
        </span>
      </button>
      <Modal open={accessibleConfirm && !disabled} onClose={() => setAccessibleConfirm(false)} title={children}>
        <Button
          onClick={() => {
            setAccessibleConfirm(false);
            if (!disabled) callback.current();
          }}
        >
          {t("confirm")}
        </Button>
      </Modal>
    </>
  );
}
