import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import "./interaction.css";
export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}
function Overlay({ open, onClose, title, children, sheet = false }: OverlayProps & { sheet?: boolean }) {
  const { t } = useTranslation("shared/ui");
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const callback = useRef(onClose);
  const active = useRef(false);
  useEffect(() => {
    callback.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    active.current = true;
    element.showModal();
    return () => {
      active.current = false;
      if (element.open) element.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className={`nd-overlay ${sheet ? "nd-sheet" : "nd-modal"}`}
      aria-labelledby={id}
      onClose={() => {
        if (active.current) {
          active.current = false;
          callback.current();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        callback.current();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          callback.current();
      }}
    >
      {sheet && <div className="nd-sheet-handle" aria-hidden="true" />}
      <header className="nd-overlay-header">
        <h2 id={id}>{title}</h2>
        <Button autoFocus variant="ghost" onClick={onClose}>
          {t("close")}
        </Button>
      </header>
      <div className="nd-overlay-body">{children}</div>
    </dialog>
  );
}
export function Modal(props: OverlayProps) {
  return <Overlay {...props} />;
}
export function Sheet(props: OverlayProps) {
  return <Overlay {...props} sheet />;
}
