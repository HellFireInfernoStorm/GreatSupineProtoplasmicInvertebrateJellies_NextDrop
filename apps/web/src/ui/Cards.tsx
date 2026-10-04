import type { ReactNode } from "react";
import type { TripStatus } from "@nextdrop/contracts";
import { useTranslation } from "react-i18next";
import { Pill, StatusPill } from "./StatusPill";
import { Instant } from "./Timeline";
import { TRIP_TONES, type OrderStatus } from "./status";
import { isInstant } from "./instant";
import { formatDay, formatTime } from "../lib/time";
import "./display.css";

export interface TripCardProps {
  id: string;
  vehicle: ReactNode;
  departure: string;
  status: TripStatus;
  changed?: ReactNode;
  children?: ReactNode;
}
export function TripCard({ id, vehicle, departure, status, changed, children }: TripCardProps) {
  const { t } = useTranslation("shared/ui");
  return (
    <article className="nd-card nd-trip" data-changed={changed ? "true" : undefined}>
      <div className="nd-trip-departure">
        <span className="nd-trip-caption">{t("trip.departure")}</span>
        {isInstant(departure) ? (
          <time dateTime={departure}>
            <span className="nd-trip-day">{formatDay(departure)}</span>
            <span className="nd-trip-time">{formatTime(departure)}</span>
          </time>
        ) : (
          <Instant instant={departure} />
        )}
      </div>
      <div className="nd-card-body">
        <h2 className="nd-card-title">
          <span className="nd-id">{id}</span>
        </h2>
        <div className="nd-trip-detail">{vehicle}</div>
      </div>
      <div className="nd-trip-state">
        <Pill tone={TRIP_TONES[status]}>{t(`tripStatus.${status}`)}</Pill>
        {changed && <Pill tone="warn">{t("trip.changed")}</Pill>}
      </div>
      {changed && <div className="nd-trip-changed">{changed}</div>}
      {children && <div className="nd-card-slot">{children}</div>}
    </article>
  );
}
export interface StopCardProps {
  id: string;
  outlet: ReactNode;
  sequence: number;
  status: OrderStatus;
  eta?: string | null;
  children?: ReactNode;
}
export function StopCard({ id, outlet, sequence, status, eta, children }: StopCardProps) {
  const { t } = useTranslation("shared/ui");
  return (
    <article className="nd-card nd-stop">
      <span className="nd-stop-marker" aria-label={t("stop.sequence", { sequence })}>
        {sequence}
      </span>
      <div className="nd-card-body">
        <h2 className="nd-card-title">
          <span className="nd-id">{id}</span> · {outlet}
        </h2>
        <StatusPill status={status} />
        {eta && (
          <div className="nd-stop-eta">
            {t("stop.eta")} <Instant instant={eta} />
          </div>
        )}
        {children && <div className="nd-card-slot">{children}</div>}
      </div>
    </article>
  );
}
