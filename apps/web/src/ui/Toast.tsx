import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { createDismissTimer } from "./dismissTimer";
import "./interaction.css";
export interface ToastProps {
  open: boolean;
  onClose: () => void;
  message: ReactNode;
  action?: ReactNode;
  durationMs?: number;
}
export function Toast({ open, onClose, message, action, durationMs = 5000 }: ToastProps) {
  const { t } = useTranslation("shared/ui");
  const callback = useRef(onClose);
  const timer = useRef<ReturnType<typeof createDismissTimer> | null>(null);
  const paused = useRef({ hover: false, focus: false });
  useEffect(() => {
    callback.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) {
      paused.current = { hover: false, focus: false };
      return;
    }
    const instance = createDismissTimer(() => callback.current(), durationMs);
    timer.current = instance;
    if (!paused.current.hover && !paused.current.focus) instance.resume();
    return () => {
      instance.dispose();
      timer.current = null;
    };
  }, [open, durationMs]);
  const update = (kind: "hover" | "focus", value: boolean) => {
    paused.current[kind] = value;
    if (paused.current.hover || paused.current.focus) timer.current?.pause();
    else timer.current?.resume();
  };
  if (!open) return null;
  return (
    <div
      className="nd-toast"
      onPointerEnter={() => update("hover", true)}
      onPointerLeave={() => update("hover", false)}
      onFocusCapture={() => update("focus", true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) update("focus", false);
      }}
    >
      <span className="nd-toast-icon nd-symbol nd-symbol-check" aria-hidden="true" />
      <div className="nd-toast-message" role="status" aria-atomic="true">
        {message}
      </div>
      {action}
      <Button variant="ghost" aria-label={t("close")} onClick={onClose}>
        ×
      </Button>
    </div>
  );
}
