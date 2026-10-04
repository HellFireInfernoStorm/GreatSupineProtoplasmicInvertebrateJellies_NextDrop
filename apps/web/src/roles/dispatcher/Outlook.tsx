import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Banner } from "../../ui";
import { Pill } from "../../ui/StatusPill";
import type { Tone } from "../../ui/status";
import { callApi } from "../../lib/api";
import { formatDay, formatDayMonth, formatDayRange, localDateInstant } from "../../lib/time";
import {
  buildOutlook,
  chartScale,
  outlookWindow,
  type Insight,
  type LoadLevel,
  type OutlookWeek,
} from "./outlook-model";

const LEVEL_TONES = { over: "danger", tight: "warn", ok: "ok" } as const satisfies Record<LoadLevel, Tone>;

// Plot geometry, from the Figma chart (277:1340): 597 × 196 with the bars between x 40 and 537.
const VIEW_W = 597;
const VIEW_H = 200;
const PLOT_LEFT = 40;
const PLOT_RIGHT = 537;
const PLOT_TOP = 32;
const BASELINE = 196;
const BAR_W = 24;

/** Outline icons from the design, drawn in the current colour so the tone tokens colour them. */
const ICONS = {
  warning: [
    "M11 2.75L2.29167 18.3333H19.7083L11 2.75Z",
    "M11 8.25V12.8333",
    "M11 16.1333C11.3038 16.1333 11.55 15.8871 11.55 15.5833C11.55 15.2796 11.3038 15.0333 11 15.0333C10.6962 15.0333 10.45 15.2796 10.45 15.5833C10.45 15.8871 10.6962 16.1333 11 16.1333Z",
  ],
  chilled: [
    "M11 1.83333V20.1667M3.85 6.41667L18.15 15.5833M18.15 6.41667L3.85 15.5833M6.41667 3.85L11 6.41667L15.5833 3.85M6.41667 18.15L11 15.5833L15.5833 18.15",
  ],
  calendar: [
    "M17.4167 4.58333H4.58333C3.57081 4.58333 2.75 5.40414 2.75 6.41667V17.4167C2.75 18.4292 3.57081 19.25 4.58333 19.25H17.4167C18.4292 19.25 19.25 18.4292 19.25 17.4167V6.41667C19.25 5.40414 18.4292 4.58333 17.4167 4.58333Z",
    "M7.33333 2.75V6.41667M14.6667 2.75V6.41667M2.75 9.16667H19.25",
  ],
  check: [
    "M11 19.25C15.5563 19.25 19.25 15.5563 19.25 11C19.25 6.44365 15.5563 2.75 11 2.75C6.44365 2.75 2.75 6.44365 2.75 11C2.75 15.5563 6.44365 19.25 11 19.25Z",
    "M7.33333 11L9.625 13.2917L14.6667 8.25",
  ],
  info: [
    "M11 19.25C15.5563 19.25 19.25 15.5563 19.25 11C19.25 6.44365 15.5563 2.75 11 2.75C6.44365 2.75 2.75 6.44365 2.75 11C2.75 15.5563 6.44365 19.25 11 19.25Z",
    "M11 7.33333V11.9167",
    "M11 15.2167C11.3038 15.2167 11.55 14.9704 11.55 14.6667C11.55 14.3629 11.3038 14.1167 11 14.1167C10.6962 14.1167 10.45 14.3629 10.45 14.6667C10.45 14.9704 10.6962 15.2167 11 15.2167Z",
  ],
} as const;

function OutlookIcon({ name, size = 22 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg
      viewBox="0 0 22 22"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

function Tile(props: {
  tone: Tone;
  icon: keyof typeof ICONS;
  accent?: boolean;
  label: string;
  value: string;
  pill?: ReactNode;
  detail: string;
}) {
  return (
    <section className="dispatch-card dispatch-queue-metric">
      <span className="dispatch-kpi-icon dispatch-outlook-icon" data-tone={props.tone} data-accent={props.accent}>
        <OutlookIcon name={props.icon} />
      </span>
      <div className="dispatch-kpi-content">
        <span className="dispatch-kpi-label">{props.label}</span>
        <div className="dispatch-outlook-value">
          <strong>{props.value}</strong>
          {props.pill}
        </div>
        <small>{props.detail}</small>
      </div>
    </section>
  );
}

interface ChartProps {
  title: string;
  subtitle: string;
  label: string;
  lineLabel: string;
  weeks: OutlookWeek[];
  value: (week: OutlookWeek) => number;
  capacity: (week: OutlookWeek) => number;
  barTitle: (week: OutlookWeek) => string;
  axisLabel: (week: OutlookWeek) => ReactNode;
  /** Tick labels. */
  number: (value: number) => string;
  /** The peak and capacity labels, with the unit. */
  m3: (value: number) => string;
}

/** A bar per week with the capacity as a line, stepped where capacity changes between weeks. */
function WeekChart(props: ChartProps) {
  const { title, subtitle, label, lineLabel, weeks, value, capacity, barTitle, axisLabel, number, m3 } = props;
  const { top, ticks } = chartScale(Math.max(...weeks.map(value), ...weeks.map(capacity)));
  const y = (v: number) => BASELINE - (v / top) * (BASELINE - PLOT_TOP);
  const band = (PLOT_RIGHT - PLOT_LEFT) / weeks.length;
  const peak = weeks.reduce((best, week) => (value(week) > value(best) ? week : best));
  const line = weeks
    .map((week, i) => `${i === 0 ? `M ${PLOT_LEFT}` : "V"} ${y(capacity(week))} H ${PLOT_LEFT + band * (i + 1)}`)
    .join(" ");
  const lastCapacity = capacity(weeks[weeks.length - 1]!);
  return (
    <section className="dispatch-card dispatch-outlook-chart">
      <h2>{title}</h2>
      <p className="dispatch-outlook-sub">{subtitle}</p>
      <figure className="dispatch-outlook-plot">
        <div className="dispatch-outlook-plot-inner">
          <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={label}>
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  className={tick === 0 ? "dispatch-outlook-baseline" : "dispatch-outlook-grid"}
                  x1={PLOT_LEFT}
                  x2={PLOT_RIGHT}
                  y1={y(tick)}
                  y2={y(tick)}
                />
                <text className="dispatch-outlook-tick" x={PLOT_LEFT - 8} y={y(tick) + 4} textAnchor="end">
                  {number(tick)}
                </text>
              </g>
            ))}
            {weeks.map((week, i) => {
              const v = value(week);
              const x = PLOT_LEFT + band * (i + 0.5) - BAR_W / 2;
              const barTop = y(v);
              const r = Math.min(4, BASELINE - barTop);
              return (
                <g key={week.key}>
                  <path
                    className="dispatch-outlook-bar"
                    d={`M ${x} ${BASELINE} V ${barTop + r} Q ${x} ${barTop} ${x + r} ${barTop} H ${x + BAR_W - r} Q ${x + BAR_W} ${barTop} ${x + BAR_W} ${barTop + r} V ${BASELINE} Z`}
                  >
                    <title>{barTitle(week)}</title>
                  </path>
                  {week === peak && v > 0 && (
                    <text
                      className="dispatch-outlook-peak"
                      x={x + BAR_W / 2}
                      y={Math.max(12, barTop - 8)}
                      textAnchor="middle"
                    >
                      {m3(v)}
                    </text>
                  )}
                </g>
              );
            })}
            <path className="dispatch-outlook-capacity" d={line} />
            <text className="dispatch-outlook-line-value" x={PLOT_RIGHT + 6} y={y(lastCapacity) + 5}>
              {m3(lastCapacity)}
            </text>
            <text className="dispatch-outlook-line-label" x={PLOT_RIGHT + 6} y={y(lastCapacity) + 21}>
              {lineLabel}
            </text>
          </svg>
          <div
            className="dispatch-outlook-axis"
            aria-hidden="true"
            style={{
              gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`,
              marginLeft: `${(PLOT_LEFT / VIEW_W) * 100}%`,
              marginRight: `${((VIEW_W - PLOT_RIGHT) / VIEW_W) * 100}%`,
            }}
          >
            {weeks.map((week) => (
              <div key={week.key}>{axisLabel(week)}</div>
            ))}
          </div>
        </div>
      </figure>
    </section>
  );
}

/** D5 Capacity outlook: forecast against usable fleet and reefer capacity for seven weeks (ADR 0056, ADR 0010). */
export function Outlook({ depot, date }: { depot: string; date: string }) {
  const { t, i18n } = useTranslation("dispatcher/planning");
  const range = outlookWindow(date);
  const outlook = useQuery({
    queryKey: ["dispatch", depot, range.from, "outlook", range.weeks],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      callApi("outlook", { query: { depot, from: range.from, weeks: range.weeks }, signal }),
  });
  const calendar = useQuery({
    queryKey: ["dispatch", "calendar", range.from, range.to],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      callApi("calendar", { query: { from: range.from, to: range.to }, signal }),
  });
  if (outlook.isError) return <Banner tone="warn" message={t("outlookView.error")} />;
  // Without the calendar the screen still shows the numbers, only without the payday and festival flags.
  if (!outlook.data || calendar.isPending) return <p>{t("outlookView.loading")}</p>;
  const model = buildOutlook(date, outlook.data.items, calendar.data?.items ?? []);
  if (!model) return <p>{t("outlookView.empty")}</p>;

  const number = (value: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1 }).format(value);
  const m3 = (value: number) => t("outlookView.m3", { value: number(value) });
  const weekName = (week: OutlookWeek) => t("outlookView.weekLabel", { week: week.isoWeek });
  const weekList = (weeks: OutlookWeek[], separator: string) => weeks.map(weekName).join(separator);
  const festival = (code: string) =>
    t(`outlookView.festivals.${code}`, {
      defaultValue: code.charAt(0).toUpperCase() + code.slice(1).replace(/_/g, " "),
    });
  const flags = (week: OutlookWeek) => [
    ...(week.payday ? [t("outlookView.payday")] : []),
    ...(week.festival ? [festival(week.festival.name)] : []),
  ];
  const percentRange = ([from, to]: [number, number]) =>
    from === to ? t("outlookView.percent", { value: from }) : t("outlookView.percentRange", { from, to });
  const load = (percent: number | null, level: LoadLevel) =>
    percent === null ? (
      t("outlookView.none")
    ) : level === "ok" ? (
      t("outlookView.percent", { value: percent })
    ) : (
      <Pill tone={LEVEL_TONES[level]}>
        {t(level === "over" ? "outlookView.loadOver" : "outlookView.loadTight", { percent })}
      </Pill>
    );

  const { peak, chilledPeak, paydayWeeks, paydayRange, headroomWeeks } = model;
  const chilledGap = chilledPeak.chilledM3 - chilledPeak.reeferM3;
  const axisLabel = (week: OutlookWeek) => (
    <>
      <strong>{weekName(week)}</strong>
      <span>{formatDayMonth(localDateInstant(week.monday))}</span>
      {flags(week).map((flag) => (
        <span key={flag} className="dispatch-outlook-flag">
          {flag}
        </span>
      ))}
    </>
  );
  const insight = (item: Insight): { tone: Tone; icon: keyof typeof ICONS; title: string; detail: string } => {
    switch (item.kind) {
      case "overFleet":
        return {
          tone: "danger",
          icon: "warning",
          title: t("outlookView.overFleetTitle", { week: weekName(item.week) }),
          detail: t("outlookView.overFleetDetail"),
        };
      case "overReefer":
        return {
          tone: "danger",
          icon: "warning",
          title: t("outlookView.overReeferTitle", { week: weekName(item.week) }),
          detail: item.bookBy
            ? t("outlookView.overReeferDetail", { date: formatDay(localDateInstant(item.bookBy)) })
            : t("outlookView.overReeferNow"),
        };
      case "paydayTight":
        return {
          tone: "warn",
          icon: "info",
          title: t("outlookView.paydayTightTitle", { count: item.weeks.length, range: percentRange(item.range) }),
          detail: t("outlookView.paydayTightDetail"),
        };
      case "tight":
        return {
          tone: "warn",
          icon: "info",
          title: t("outlookView.tightTitle", { count: item.weeks.length, weeks: weekList(item.weeks, ", ") }),
          detail: t("outlookView.tightDetail"),
        };
      case "allHeadroom":
        return {
          tone: "ok",
          icon: "check",
          title: t("outlookView.allHeadroomTitle", { count: item.count }),
          detail: t("outlookView.allHeadroomDetail"),
        };
      case "noneOver":
        return {
          tone: "ok",
          icon: "check",
          title: t("outlookView.noneOverTitle"),
          detail: t("outlookView.noneOverDetail"),
        };
    }
  };

  return (
    <div className="dispatch-outlook">
      <div className="dispatch-kpis dispatch-queue-kpis dispatch-outlook-tiles">
        <Tile
          tone={LEVEL_TONES[peak.level]}
          icon={peak.level === "ok" ? "check" : "warning"}
          label={t("outlookView.peakLabel")}
          value={weekName(peak)}
          pill={
            peak.loadPercent !== null && (
              <Pill tone={LEVEL_TONES[peak.level]}>{t("outlookView.peakPill", { percent: peak.loadPercent })}</Pill>
            )
          }
          detail={t(peak.festival ? "outlookView.peakDetailFestival" : "outlookView.peakDetail", {
            demand: number(peak.demandM3),
            capacity: number(peak.capacityM3),
            festival: peak.festival ? festival(peak.festival.name) : "",
            date: peak.festival ? formatDay(localDateInstant(peak.festival.date)) : "",
          })}
        />
        <Tile
          tone="chilled"
          icon="chilled"
          label={t("outlookView.chilledLabel")}
          value={m3(chilledPeak.chilledM3)}
          pill={
            <Pill tone={LEVEL_TONES[chilledPeak.chilledLevel]}>
              {t(chilledGap > 0 ? "outlookView.chilledOver" : "outlookView.chilledSpare", {
                amount: number(Math.abs(chilledGap)),
              })}
            </Pill>
          }
          detail={t("outlookView.chilledDetail", { reefer: number(chilledPeak.reeferM3) })}
        />
        <Tile
          tone="warn"
          icon="calendar"
          accent
          label={t("outlookView.paydayLabel")}
          value={paydayWeeks.length ? weekList(paydayWeeks, " · ") : t("outlookView.paydayNone")}
          pill={paydayRange && <Pill tone={LEVEL_TONES[model.paydayLevel]}>{percentRange(paydayRange)}</Pill>}
          detail={t(
            !paydayRange
              ? "outlookView.paydayNoneDetail"
              : model.paydayLevel === "over"
                ? "outlookView.paydayOverDetail"
                : model.paydayLevel === "tight"
                  ? "outlookView.paydayTightTile"
                  : "outlookView.paydayOkDetail",
          )}
        />
        <Tile
          tone="ok"
          icon="check"
          label={t("outlookView.headroomLabel")}
          value={t("outlookView.headroomValue", { count: headroomWeeks.length, total: model.weeks.length })}
          pill={<Pill tone="ok">{t("outlookView.headroomPill")}</Pill>}
          detail={headroomWeeks.length ? weekList(headroomWeeks, ", ") : t("outlookView.headroomNone")}
        />
      </div>
      <div className="dispatch-outlook-charts">
        <WeekChart
          title={t("outlookView.demandTitle")}
          subtitle={t("outlookView.demandSubtitle")}
          label={t("outlookView.demandChartLabel", { week: weekName(peak), value: number(peak.demandM3) })}
          lineLabel={t("outlookView.fleetLine")}
          weeks={model.weeks}
          value={(week) => week.demandM3}
          capacity={(week) => week.capacityM3}
          barTitle={(week) =>
            t("outlookView.barTitle", {
              week: weekName(week),
              value: number(week.demandM3),
              capacity: number(week.capacityM3),
            })
          }
          axisLabel={axisLabel}
          number={number}
          m3={m3}
        />
        <WeekChart
          title={t("outlookView.chilledTitle")}
          subtitle={t("outlookView.chilledSubtitle")}
          label={t("outlookView.chilledChartLabel", {
            week: weekName(chilledPeak),
            value: number(chilledPeak.chilledM3),
          })}
          lineLabel={t("outlookView.reeferLine")}
          weeks={model.weeks}
          value={(week) => week.chilledM3}
          capacity={(week) => week.reeferM3}
          barTitle={(week) =>
            t("outlookView.barTitle", {
              week: weekName(week),
              value: number(week.chilledM3),
              capacity: number(week.reeferM3),
            })
          }
          axisLabel={axisLabel}
          number={number}
          m3={m3}
        />
      </div>
      <div className="dispatch-outlook-bottom">
        <section className="dispatch-card dispatch-outlook-table" aria-labelledby="dispatch-outlook-table-title">
          <h2 id="dispatch-outlook-table-title">{t("outlookView.tableTitle")}</h2>
          <div className="dispatch-table-scroll">
            <table aria-labelledby="dispatch-outlook-table-title">
              <thead>
                <tr>
                  <th scope="col">{t("outlookView.week")}</th>
                  <th scope="col">{t("outlookView.dates")}</th>
                  <th scope="col">{t("outlookView.forecast")}</th>
                  <th scope="col">{t("outlookView.fleet")}</th>
                  <th scope="col" aria-label={t("outlookView.fleetLoadFull")}>
                    {t("outlookView.load")}
                  </th>
                  <th scope="col">{t("outlookView.chilled")}</th>
                  <th scope="col">{t("outlookView.reefer")}</th>
                  <th scope="col" aria-label={t("outlookView.reeferLoadFull")}>
                    {t("outlookView.load")}
                  </th>
                  <th scope="col">{t("outlookView.flag")}</th>
                </tr>
              </thead>
              <tbody>
                {model.weeks.map((week) => (
                  <tr key={week.key}>
                    <th scope="row">{weekName(week)}</th>
                    <td>{formatDayRange(localDateInstant(week.monday), localDateInstant(week.saturday))}</td>
                    <td>{m3(week.demandM3)}</td>
                    <td>{m3(week.capacityM3)}</td>
                    <td>{load(week.loadPercent, week.level)}</td>
                    <td>{m3(week.chilledM3)}</td>
                    <td>{m3(week.reeferM3)}</td>
                    <td>{load(week.chilledLoadPercent, week.chilledLevel)}</td>
                    <td>{flags(week).join(" · ") || t("outlookView.none")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="dispatch-card dispatch-outlook-insights">
          <h2>{t("outlookView.insightsTitle")}</h2>
          <ul>
            {model.insights.map((item) => {
              const view = insight(item);
              return (
                <li key={view.title}>
                  <span className="dispatch-outlook-icon" data-tone={view.tone}>
                    <OutlookIcon name={view.icon} size={16} />
                  </span>
                  <span>
                    <strong>{view.title}</strong>
                    <small>{view.detail}</small>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
