import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { statusTone, type OrderStatus, type Tone } from "./status";
import "./display.css";

export function Pill({ tone, children, icon }: { tone: Tone; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className="nd-pill" data-tone={tone}>
      <span className={`nd-pill-icon${icon ? "" : " nd-pill-default"}`} aria-hidden="true">
        {icon ?? (
          <span
            className={`nd-symbol nd-symbol-${tone === "chilled" ? "chilled" : tone === "ok" ? "check" : tone === "info" ? "loading" : tone === "neutral" ? "dot" : "warning"}`}
          />
        )}
      </span>
      {children}
    </span>
  );
}
export function StatusPill({ status, icon }: { status: OrderStatus; icon?: ReactNode }) {
  const { t } = useTranslation("shared/ui");
  return (
    <Pill tone={statusTone(status)} icon={icon}>
      {t(`status.${status}`, { defaultValue: t("statusUnknown") })}
    </Pill>
  );
}
export function FlagPill({ flag, icon }: { flag: "short" | "damaged"; icon?: ReactNode }) {
  const { t } = useTranslation("shared/ui");
  return (
    <Pill tone={flag === "short" ? "warn" : "danger"} icon={icon}>
      {t(`flags.${flag}`)}
    </Pill>
  );
}
export function ChilledPill({ icon }: { icon?: ReactNode }) {
  const { t } = useTranslation("shared/ui");
  return (
    <Pill tone="chilled" icon={icon ?? <span className="nd-chilled-icon" />}>
      {t("chilled")}
    </Pill>
  );
}
export type SyncState = "offline" | "saved" | "sending" | "synced" | "seen";
const syncTones = { offline: "warn", saved: "neutral", sending: "info", synced: "ok", seen: "info" } as const;
export function SyncPill({ state, detail }: { state: SyncState; detail?: ReactNode }) {
  const { t } = useTranslation("shared/ui");
  return (
    <span className="nd-sync">
      <Pill
        tone={syncTones[state]}
        icon={
          <span
            className={`nd-symbol nd-symbol-${state === "sending" ? "loading" : "dot"}${state === "offline" ? " nd-symbol-hollow" : ""}`}
          />
        }
      >
        {t(`sync.${state}`)}
        {detail && <> · {detail}</>}
      </Pill>
    </span>
  );
}
