import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { addDays } from "@nextdrop/rules";
import { Banner } from "../../ui";
import { callApi } from "../../lib/api";

const WEEKS_BACK = 8;
const WEEKS = 12;
const m3 = (litres: number) => litres / 1000;
const fmt = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });

/** D5 Capacity outlook: weekly demand in m³ against the depot's fleet capacity, with a table twin (ADR 0010). */
export function Outlook({ depot, date }: { depot: string; date: string }) {
  const { t } = useTranslation("dispatcher/planning");
  const from = addDays(date, -7 * WEEKS_BACK);
  const outlook = useQuery({
    queryKey: ["dispatch", depot, from, "outlook"],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      callApi("outlook", { query: { depot, from, weeks: WEEKS }, signal }),
  });
  if (outlook.isError) return <Banner tone="warn" message={t("outlookView.error")} />;
  if (!outlook.data) return <p>{t("outlookView.loading")}</p>;
  const weeks = new Map<string, { label: string; demand: number; chilled: number; capacity: number }>();
  for (const item of outlook.data.items) {
    const key = `${item.isoYear}-W${String(item.isoWeek).padStart(2, "0")}`;
    const week = weeks.get(key) ?? { label: key, demand: 0, chilled: 0, capacity: m3(item.capacityVolumeL) };
    week.demand += m3(item.demandVolumeL);
    week.chilled += m3(item.chilledVolumeL);
    weeks.set(key, week);
  }
  const rows = [...weeks.values()];
  if (!rows.length) return <p>{t("outlookView.empty")}</p>;
  const capacity = rows[0]!.capacity;
  const max = Math.max(capacity, ...rows.map((r) => r.demand)) * 1.1 || 1;
  const width = 720;
  const height = 260;
  const pad = { left: 56, right: 16, top: 16, bottom: 40 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const band = plotW / rows.length;
  const y = (value: number) => pad.top + plotH - (value / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  return (
    <section className="dispatch-outlook">
      <figure>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={t("outlookView.chartLabel", { capacity: fmt(capacity) })}
          style={{ width: "100%", maxWidth: width, height: "auto" }}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="currentColor"
                opacity={0.1}
              />
              <text x={pad.left - 6} y={y(tick) + 4} textAnchor="end" fontSize={11} fill="currentColor">
                {fmt(tick)}
              </text>
            </g>
          ))}
          <text
            x={12}
            y={pad.top + plotH / 2}
            fontSize={11}
            fill="currentColor"
            transform={`rotate(-90 12 ${pad.top + plotH / 2})`}
          >
            {t("outlookView.axis")}
          </text>
          {rows.map((row, i) => (
            <g key={row.label}>
              <rect
                x={pad.left + i * band + band * 0.2}
                width={band * 0.6}
                y={y(row.demand)}
                height={pad.top + plotH - y(row.demand)}
                fill={row.demand > capacity ? "var(--nd-danger)" : "var(--nd-primary)"}
                rx={2}
              >
                <title>{t("outlookView.barTitle", { week: row.label, demand: fmt(row.demand) })}</title>
              </rect>
              <text
                x={pad.left + i * band + band / 2}
                y={height - pad.bottom + 16}
                textAnchor="middle"
                fontSize={10}
                fill="currentColor"
              >
                {row.label.slice(5)}
              </text>
            </g>
          ))}
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={y(capacity)}
            y2={y(capacity)}
            stroke="currentColor"
            strokeDasharray="6 4"
            strokeWidth={1.5}
          />
          <text x={width - pad.right} y={y(capacity) - 6} textAnchor="end" fontSize={11} fill="currentColor">
            {t("outlookView.capacityLine", { capacity: fmt(capacity) })}
          </text>
        </svg>
        <figcaption>{t("outlookView.caption")}</figcaption>
      </figure>
      <table>
        <caption>{t("outlookView.tableCaption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("outlookView.week")}</th>
            <th scope="col">{t("outlookView.demand")}</th>
            <th scope="col">{t("outlookView.chilled")}</th>
            <th scope="col">{t("outlookView.capacity")}</th>
            <th scope="col">{t("outlookView.utilisation")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{fmt(row.demand)}</td>
              <td>{fmt(row.chilled)}</td>
              <td>{fmt(row.capacity)}</td>
              <td>{capacity ? Math.round((row.demand / capacity) * 100) : 0}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
