import type { ReactNode } from "react";
import "./display.css";

export interface EmptyStateProps {
  title: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}
export function EmptyState({ title, detail, icon, action }: EmptyStateProps) {
  return (
    <div className="nd-empty">
      {icon && (
        <div className="nd-empty-icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <h2>{title}</h2>
      {detail && <p>{detail}</p>}
      {action}
    </div>
  );
}
