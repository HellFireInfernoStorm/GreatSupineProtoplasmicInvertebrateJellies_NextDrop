import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatDay, formatTime, sameDisplayDay } from "../lib/time";
import "./display.css";
import { isInstant } from "./instant";
import { useServerNow } from "../lib/clock";

export interface TimelineEvent {
  id: string;
  title: ReactNode;
  detail?: ReactNode;
  actor?: ReactNode;
  capturedAt: string;
  confirmedAt: string | null;
}
export function Instant({ instant }: { instant: string }) {
  const { t } = useTranslation("shared/ui");
  const now = useServerNow(60_000);
  if (!isInstant(instant)) return <span>{t("timeUnavailable")}</span>;
  return (
    <time dateTime={instant}>
      {!sameDisplayDay(instant, now.getTime()) && <>{formatDay(instant)} · </>}
      {formatTime(instant)}
    </time>
  );
}
export function Timeline({ events }: { events: readonly TimelineEvent[] }) {
  const { t } = useTranslation("shared/ui");
  return (
    <ol className="nd-timeline">
      {events.map((event) => (
        <li className="nd-timeline-event" key={event.id}>
          <span className="nd-timeline-marker" aria-hidden="true" />
          <div className="nd-timeline-body">
            <div className="nd-timeline-title">{event.title}</div>
            {event.detail && <div className="nd-timeline-detail">{event.detail}</div>}
            {event.actor && <div className="nd-timeline-actor">{event.actor}</div>}
            <div className="nd-timeline-time">
              {t("timeline.captured")} <Instant instant={event.capturedAt} />
            </div>
            <div className="nd-timeline-time">
              {event.confirmedAt === null ? (
                t("timeline.pending")
              ) : (
                <>
                  {t("timeline.confirmed")} <Instant instant={event.confirmedAt} />
                </>
              )}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
export function TimelineCard({ title, events }: { title: ReactNode; events: readonly TimelineEvent[] }) {
  return (
    <section className="nd-card">
      <h2 className="nd-card-title">{title}</h2>
      <Timeline events={events} />
    </section>
  );
}
