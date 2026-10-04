import { useState, type ReactNode } from "react";
import { useSearchParams, Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { ApiDto } from "@nextdrop/contracts";
import { CapacityBar, ChilledPill, StatusPill } from "../../ui";
import { Pill } from "../../ui/StatusPill";
import { Instant } from "../../ui/Timeline";
import type { Outlet, Vehicle } from "./planning";
import confirmedIcon from "./assets/confirmed.svg";
import weightIcon from "./assets/weight.svg";
import chilledIcon from "./assets/chilled.svg";
import vanIcon from "./assets/van.svg";

function QueueMetric({ icon, tone, children }: { icon: string; tone: string; children: ReactNode }) {
  return (
    <section className="dispatch-card dispatch-queue-metric">
      <span className="dispatch-kpi-icon" data-tone={tone}>
        <img src={icon} alt="" />
      </span>
      <div className="dispatch-kpi-content">{children}</div>
    </section>
  );
}

export function OrderQueue({
  day,
  outlets,
  vehicles,
}: {
  day: ApiDto<"dayResponse">;
  outlets: readonly Outlet[];
  vehicles: readonly Vehicle[];
}) {
  const { t } = useTranslation("dispatcher/planning");
  const [params, setParams] = useSearchParams();
  const search = params.get("q") ?? "";
  const setSearch = (value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set("q", value);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  const [brand, setBrand] = useState("");
  const [district, setDistrict] = useState("");
  const [flag, setFlag] = useState("");
  const getOutlet = (id: string) => outlets.find((o) => o.id === id);
  const matches = day.queue.filter((order) => {
    const outlet = getOutlet(order.outletId);
    return (
      (!brand || order.brand === brand) &&
      (!district || outlet?.district === district) &&
      (!flag ||
        (flag === "chilled"
          ? order.tempRequirement === "chilled"
          : flag === "vanOnly"
            ? outlet?.parking === "van_only"
            : flag === "skippedPrevious"
              ? day.planningContext.outletService.some(
                  (item) => item.outletId === order.outletId && item.deferredLastRun,
                )
              : outlet?.mallWindow !== null && outlet?.mallWindow !== undefined)) &&
      (!search ||
        [order.displayId, outlet?.displayId, outlet?.name].some((value) =>
          value?.toLowerCase().includes(search.toLowerCase()),
        ))
    );
  });
  const selected = day.queue.find((o) => o.id === params.get("order")) ?? matches[0];
  const outlet = selected ? getOutlet(selected.outletId) : null;
  const flags = (order: ApiDto<"order">) => {
    const out = getOutlet(order.outletId);
    return (
      <span className="dispatch-flags">
        {order.tempRequirement === "chilled" && <ChilledPill />}
        {out?.parking === "van_only" && <Pill tone="deferred">{t("vanOnly")}</Pill>}
        {out?.mallWindow && <Pill tone="neutral">{t("mallWindow")}</Pill>}
        {out && (
          <Pill tone="neutral">
            {t(out.dockType === "rear_dock" ? "rearDock" : out.dockType === "street" ? "streetDock" : "mallDock")}
          </Pill>
        )}
        {day.planningContext.outletService.some((item) => item.outletId === order.outletId && item.deferredLastRun) && (
          <Pill tone="warn">{t("skippedPrevious")}</Pill>
        )}
        {order.deferredCount > 0 && <Pill tone="warn">{t("previouslyDeferred")}</Pill>}
      </span>
    );
  };
  const clock = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const selectOrder = (id: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("order", id);
      return next;
    });
  return (
    <>
      <div className="dispatch-kpis dispatch-queue-kpis">
        <QueueMetric icon={confirmedIcon} tone="ok">
          <span className="dispatch-kpi-label">{t("confirmed")}</span>
          <strong>{day.queue.length}</strong>
          <small>
            {["Fresh", "Style", "Tech"]
              .map((brand) => `${t(`brands.${brand}`)} ${day.queue.filter((order) => order.brand === brand).length}`)
              .join(" · ")}
          </small>
        </QueueMetric>
        <QueueMetric icon={weightIcon} tone="info">
          <CapacityBar
            label={t("weightFleet")}
            used={day.queue.reduce((n, o) => n + o.weightG, 0) / 1000000}
            capacity={vehicles.reduce((n, v) => n + v.weightCapG, 0) / 1000000}
            unit={t("units.t")}
            tone="ok"
            presentation="summary"
          />
        </QueueMetric>
        <QueueMetric icon={chilledIcon} tone="warn">
          <CapacityBar
            label={t("chilledCapacity")}
            used={day.queue.filter((o) => o.tempRequirement === "chilled").reduce((n, o) => n + o.volumeL, 0) / 1000}
            capacity={vehicles.filter((v) => v.temp === "reefer").reduce((n, v) => n + v.volumeCapL, 0) / 1000}
            unit={t("units.m3")}
            presentation="summary"
          />
        </QueueMetric>
        <QueueMetric icon={vanIcon} tone="deferred">
          <span className="dispatch-kpi-label">{t("vanOrders")}</span>
          <strong>{day.queue.filter((o) => getOutlet(o.outletId)?.parking === "van_only").length}</strong>
          <small>{t("availableVans", { count: vehicles.filter((vehicle) => vehicle.type === "van").length })}</small>
        </QueueMetric>
      </div>
      <div className="dispatch-filters">
        <input
          aria-label={t("search")}
          placeholder={t("search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label={t("brand")} value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="">{t("allBrands")}</option>
          {["Fresh", "Style", "Tech"].map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <select aria-label={t("district")} value={district} onChange={(e) => setDistrict(e.target.value)}>
          <option value="">{t("allDistricts")}</option>
          {[...new Set(outlets.map((o) => o.district))].sort().map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select aria-label={t("flags")} value={flag} onChange={(e) => setFlag(e.target.value)}>
          <option value="">{t("anyFlag")}</option>
          {["chilled", "vanOnly", "mallWindow", "skippedPrevious"].map((f) => (
            <option value={f} key={f}>
              {t(f)}
            </option>
          ))}
        </select>
      </div>
      <div className="dispatch-queue-grid">
        <section className="dispatch-card">
          <div className="dispatch-table-scroll">
            <table>
              <thead>
                <tr>
                  {["order", "outlet", "brand", "window", "flags", "days", "status"].map((key) => (
                    <th key={key}>{t(key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matches.map((order) => {
                  const out = getOutlet(order.outletId);
                  return (
                    <tr
                      key={order.id}
                      data-selected={order.id === selected?.id}
                      tabIndex={0}
                      aria-selected={order.id === selected?.id}
                      onClick={() => selectOrder(order.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectOrder(order.id);
                        }
                      }}
                    >
                      <td>
                        <strong>{order.displayId}</strong>
                      </td>
                      <td>
                        {out?.displayId ?? t("unavailable")}
                        <small>{out?.name}</small>
                      </td>
                      <td>{t(`brands.${order.brand}`)}</td>
                      <td>{out ? `${clock(out.window.open)}–${clock(out.window.close)}` : t("unavailable")}</td>
                      <td>{flags(order)}</td>
                      <td>
                        {day.planningContext.outletService.find((item) => item.outletId === order.outletId)
                          ?.daysSinceLastServed ?? t("unavailable")}
                      </td>
                      <td>
                        <StatusPill status={order.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!matches.length && <p>{t("noMatches")}</p>}
        </section>
        <aside className="dispatch-card">
          {selected ? (
            <>
              <header className="dispatch-card-heading">
                <h2>{selected.displayId}</h2>
                <StatusPill status={selected.status} />
              </header>
              <p>
                {outlet?.displayId} · {outlet?.name} · {outlet?.district}
              </p>
              {flags(selected)}
              <dl className="dispatch-detail">
                <dt>{t("load")}</dt>
                <dd>
                  {selected.weightG / 1000} {t("units.kg")} · {selected.volumeL / 1000} {t("units.m3")}
                </dd>
                <dt>{t("window")}</dt>
                <dd>{outlet ? `${clock(outlet.window.open)}–${clock(outlet.window.close)}` : t("unavailable")}</dd>
                <dt>{t("placed")}</dt>
                <dd>
                  <Instant instant={selected.placedAt} />
                </dd>
                {selected.confirmedAt && (
                  <>
                    <dt>{t("confirmedAt")}</dt>
                    <dd>
                      <Instant instant={selected.confirmedAt} />
                    </dd>
                  </>
                )}
              </dl>
              <Link to={`/dispatch/plan?order=${encodeURIComponent(selected.id)}`}>{t("openPlan")} ›</Link>
            </>
          ) : (
            <p>{t("selectOrder")}</p>
          )}
        </aside>
      </div>
    </>
  );
}
