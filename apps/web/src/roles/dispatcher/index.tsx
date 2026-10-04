import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate, useSearchParams } from "react-router";
import { addDays } from "@nextdrop/rules";
import { localDate } from "@nextdrop/contracts";
import { useTranslation } from "react-i18next";
import { RoleShell } from "../../app/RoleShell";
import { useSession, signOut } from "../../lib/session";
import { useServerNow } from "../../lib/clock";
import { formatDay } from "../../lib/time";
import { Logo } from "../../ui/Logo";
import { Button } from "../../ui";
import { Notifications } from "./Notifications";
import { Workspace } from "./Workspace";
import { Outlook } from "./Outlook";
import { OUTLOOK_WEEKS } from "./outlook-model";
import { DeliveryProgress } from "./progress/DeliveryProgress";
import { useDispatchFeed } from "./feed";
import { initialDepot } from "./depot";
import "./dispatcher.css";

const nav = ["dashboard", "queue", "plan", "defer", "runs", "outlook", "fleet", "settings"] as const;
const navPaths = [
  "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  "M6 3h9l3 3v15H6zM9 10h6M9 14h6",
  "M5 5v14M12 5v14M19 5v14M3 8h4M10 12h4M17 16h4",
  "M5 6H2v-3M3 6a9 9 0 1 1 0 10M12 7v5l3 2",
  "M2 7h12v10H2zM14 10h4l4 4v3h-8M5 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4M18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
  "M4 20v-8h4v8M10 20V4h4v16M16 20v-12h4v12",
  "M2 7h12v10H2zM14 10h4l4 4v3h-8M5 20h2M18 20h2",
  "M12 3v3M12 18v3M3 12h3M18 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2M16 12a4 4 0 1 0-8 0 4 4 0 0 0 8 0",
];

export function DispatcherShell() {
  return (
    <RoleShell role="DISPATCHER">
      <DispatcherFrame />
    </RoleShell>
  );
}

function DispatcherFrame() {
  const { user } = useSession();
  const { t } = useTranslation("dispatcher/planning");
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const now = useServerNow(60_000);
  // Live updates for every dispatcher screen, D4 above all (spec/sync/change-feed.md).
  useDispatchFeed();
  const initialDate = addDays(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Colombo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now),
    1,
  );
  const linkedDate = params.get("day");
  const acceptedDate = linkedDate && localDate.safeParse(linkedDate).success ? linkedDate : null;
  const linkedDepot = params.get("depot");
  const acceptedDepot =
    user.role === "DISPATCHER" && linkedDepot && user.depots.includes(linkedDepot) ? linkedDepot : null;
  const linkedScope = `${acceptedDate ?? ""}|${acceptedDepot ?? ""}`;
  // The depot chosen at sign-in arrives as `?depot=`; without one the account's default applies (#131).
  const [scope, setScope] = useState(() => ({
    date: initialDate,
    depot: user.role === "DISPATCHER" ? initialDepot(user.depots, linkedDepot) : "",
    link: "|",
  }));
  // Take a new deep-link scope (sign-in, notifications) into state before navigation removes its query parameters.
  if (scope.link !== linkedScope)
    setScope({ date: acceptedDate ?? scope.date, depot: acceptedDepot ?? scope.depot, link: linkedScope });
  const date = acceptedDate ?? scope.date;
  // The state owns the depot, so the selector applies at once and the URL below only mirrors it.
  const depot = scope.depot;
  // Keep the accepted workspace scope recoverable after navigation and a full reload.
  useEffect(() => {
    if (params.get("day") === date && params.get("depot") === depot) return;
    const next = new URLSearchParams(params);
    next.set("day", date);
    next.set("depot", depot);
    setParams(next, { replace: true });
  }, [params, date, depot, setParams]);
  const [search, setSearch] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const page = pathname.split("/")[2] || "dashboard";
  // D4 watches today's runs, whatever planning day the workspace shows.
  const live = page === "runs";
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", hourCycle: "h23" }).format(now),
  );
  if (user.role !== "DISPATCHER") return null;
  return (
    <div className="dispatch-frame">
      <aside className="dispatch-sidebar">
        <Logo panel="dispatcher" className="dispatch-logo" />
        <p className="dispatch-role">{t("role")}</p>
        <nav>
          {nav.map((key, i) => (
            <NavLink key={key} to={key === "dashboard" ? "/dispatch" : `/dispatch/${key}`} end={key === "dashboard"}>
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={navPaths[i]} />
              </svg>
              {t(`nav.${key}`)}
            </NavLink>
          ))}
        </nav>
        <footer>
          <span className="dispatch-avatar">
            {user.displayName
              .split(" ")
              .slice(0, 2)
              .map((word) => word[0])
              .join("")}
          </span>
          <span>
            <strong>{user.displayName}</strong>
            <small>{depot}</small>
          </span>
          <Button
            variant="on-panel-outline"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              setSignOutFailed(false);
              void signOut().catch(() => {
                setSignOutFailed(true);
                setSigningOut(false);
              });
            }}
          >
            {t("signOut")}
          </Button>
          {signOutFailed && <p role="alert">{t("signOutFailed")}</p>}
        </footer>
      </aside>
      <div className="dispatch-body">
        <header className="dispatch-topbar">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              navigate(`/dispatch/queue?q=${encodeURIComponent(search)}`);
            }}
          >
            <input
              aria-label={t("search")}
              placeholder={t("search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
          <Notifications />
        </header>
        <main className="dispatch-content">
          <header className="dispatch-page-heading">
            <div>
              <h1>
                {page === "dashboard"
                  ? t("greeting", {
                      period: t(hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"),
                      name: user.displayName.split(" ")[0],
                    })
                  : t(`nav.${page}`, { defaultValue: t("nav.dashboard") })}
              </h1>
              {!live && (
                <p>
                  {page === "outlook"
                    ? t("outlookView.intro", { count: OUTLOOK_WEEKS })
                    : t("planningFor", { date: formatDay(`${date}T12:00:00+05:30`), depot })}
                </p>
              )}
            </div>
            <div className="dispatch-controls">
              <label>
                {t("depot")}
                <select
                  value={depot}
                  onChange={(e) => {
                    const value = e.target.value;
                    setScope((current) => ({ ...current, depot: value }));
                  }}
                >
                  {user.depots.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label hidden={live}>
                {t("date")}
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    if (localDate.safeParse(e.target.value).success) {
                      const next = new URLSearchParams(params);
                      next.set("day", e.target.value);
                      setParams(next);
                    }
                  }}
                />
              </label>
            </div>
          </header>
          {live ? (
            <DeliveryProgress key={depot} depot={depot} />
          ) : page === "outlook" ? (
            <Outlook key={`${depot}|${date}`} depot={depot} date={date} />
          ) : (
            <Workspace key={`${depot}|${date}`} depot={depot} date={date} />
          )}
        </main>
      </div>
    </div>
  );
}
