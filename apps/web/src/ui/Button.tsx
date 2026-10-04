import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "./display.css";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "on-panel" | "on-panel-outline" | "ok" | "warn" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  loading?: boolean;
}
export function Button({
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  disabled,
  children,
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  const { t } = useTranslation("shared/ui");
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`nd-button ${className}`}
      data-variant={variant}
      data-size={size}
    >
      {icon && (
        <span className="nd-button-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span>{children}</span>
      {loading && <span className="sr-only">{t("loading")}</span>}
    </button>
  );
}
