import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import type { Tone } from "./status";
import "./display.css";

export interface BannerProps {
  tone?: Tone;
  message: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  urgent?: boolean;
}
export function Banner({ tone = "info", message, detail, icon, action, onDismiss, urgent = false }: BannerProps) {
  const { t } = useTranslation("shared/ui");
  return (
    <div className="nd-banner" data-tone={tone} role={urgent ? "alert" : "status"}>
      {icon && (
        <span className="nd-banner-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="nd-banner-body">
        <strong>{message}</strong>
        {detail && <div>{detail}</div>}
      </div>
      {action}
      {onDismiss && (
        <Button variant="ghost" onClick={onDismiss}>
          {t("dismiss")}
        </Button>
      )}
    </div>
  );
}
