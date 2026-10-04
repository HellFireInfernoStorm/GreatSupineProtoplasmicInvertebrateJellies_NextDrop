import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";
import { useServerNow } from "../../lib/clock";
import { useIsDesktop } from "../../lib/layout";
import { signOut, useSession } from "../../lib/session";
import { formatDay } from "../../lib/time";
import { Logo } from "../../ui/Logo";
import { useOutlet } from "./data";
import { dateInstant } from "./dates";
import { Icon, type IconName } from "./icons";
import { useStoreFeed } from "./notifications/feed";
import { NotificationsBell } from "./notifications/Notifications";
import { useCountdownText } from "./order/countdown";
import { useOrderModel } from "./order/useOrderModel";

// The Store frame. Desktop (from 1024 px): the navy sidebar and a top bar, as in Figma `230:332`. Phone: each screen
// brings its own dark app bar, and top-level screens end with the bottom nav, as in `248:1062`.

const DESKTOP_NAV: readonly { to: string; key: string; icon: IconName; end?: boolean }[] = [
  { to: "/store", key: "deliveries", icon: "truck", end: true },
  { to: "/store/order/items", key: "products", icon: "bag" },
  { to: "/store/order", key: "order", icon: "plus", end: true },
  { to: "/store/tracking", key: "tracking", icon: "route" },
  { to: "/store/history", key: "history", icon: "clock" },
];

const PHONE_NAV: readonly { to: string; key: string; icon: IconName; end?: boolean }[] = [
  { to: "/store", key: "deliveries", icon: "truck", end: true },
  { to: "/store/order", key: "order", icon: "plus" },
  { to: "/store/tracking", key: "track", icon: "route" },
  { to: "/store/history", key: "historyShort", icon: "clock" },
];

function Sidebar() {
  const { t } = useTranslation("store/shell");
  const { user } = useSession();
  const outlet = useOutlet().data;
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  async function onSignOut() {
    setSigningOut(true);
    setSignOutFailed(false);
    try {
      // On success the shell sees the session go and leaves for the login screen.
      await signOut();
    } catch {
      // The server was not reached, so the session is still live there: stay signed in and say so.
      setSignOutFailed(true);
      setSigningOut(false);
    }
  }
  return (
    <aside className="flex w-60 shrink-0 flex-col bg-panel px-4 py-6 text-on-panel">
      <div className="px-2">
        <Logo panel="store" className="h-8 w-auto" />
        <p className="mt-3 text-[11px] font-semibold tracking-[0.06em] text-on-panel-muted uppercase">{t("role")}</p>
      </div>
      <nav aria-label={t("navLabel")} className="mt-8 flex flex-col gap-1.5">
        {DESKTOP_NAV.map((item) => (
          <NavLink
            key={item.key}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex h-11 items-center gap-3 rounded-lg px-3 text-sm ${
                isActive ? "bg-panel-2 font-semibold text-on-panel" : "text-on-panel-muted hover:text-on-panel"
              }`
            }
          >
            <Icon name={item.icon} />
            {t(`nav.${item.key}`)}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto border-t border-panel-line px-2 pt-4">
        <p className="text-sm font-semibold">{user.displayName}</p>
        {outlet && <p className="mt-0.5 text-xs text-on-panel-muted">{outlet.name}</p>}
        <button
          type="button"
          disabled={signingOut}
          onClick={() => void onSignOut()}
          className="mt-3 text-xs font-semibold text-on-panel-muted hover:text-on-panel disabled:opacity-60"
        >
          {t("signOut")}
        </button>
        {signOutFailed && (
          <p role="alert" className="mt-2 rounded-lg bg-warn-bg px-3 py-2 text-xs font-semibold text-warn-fg">
            {t("signOutFailed")}
          </p>
        )}
      </div>
    </aside>
  );
}

function TopBar() {
  const { t } = useTranslation("store/shell");
  const { user } = useSession();
  const model = useOrderModel();
  const left = useCountdownText(model.cutoffAtMs, model.nowMs);
  const initials = user.displayName
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <header className="flex h-[72px] shrink-0 items-center justify-between gap-4 border-b border-border bg-bg px-8">
      <div className="min-w-0">
        {model.outlet && (
          <>
            <p className="truncate text-base font-semibold">{model.outlet.name}</p>
            <p className="truncate text-xs text-muted">
              {t("outletLine", { id: model.outlet.displayId, district: model.outlet.district })}
            </p>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        <p className="flex h-9 items-center gap-2 rounded-full bg-panel px-4 text-xs text-on-panel-muted">
          <Icon name="clock" className="size-4 text-on-panel" />
          {t("cutoffPill.open", { day: formatDay(dateInstant(model.date)) })}
          <strong className="text-sm font-semibold text-on-panel">{left}</strong>
        </p>
        <NotificationsBell desktop />
        <span
          aria-hidden="true"
          className="flex size-10 items-center justify-center rounded-full bg-ok-bg text-xs font-semibold text-ok"
        >
          {initials}
        </span>
      </div>
    </header>
  );
}

export function PhoneNav() {
  const { t } = useTranslation("store/shell");
  return (
    <nav aria-label={t("navLabel")} className="flex h-[72px] shrink-0 border-t border-border bg-bg">
      {PHONE_NAV.map((item) => (
        <NavLink
          key={item.key}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center justify-center gap-1 text-xs ${
              isActive ? "font-semibold text-text" : "text-faint"
            }`
          }
        >
          <Icon name={item.icon} />
          {t(`nav.${item.key}`)}
        </NavLink>
      ))}
    </nav>
  );
}

interface PhoneScreenProps {
  title: string;
  subtitle?: string;
  /** A "back" row above the title. */
  back?: { to: string; label: string };
  /** Pinned above the bottom edge: the screen's one primary action. */
  footer?: ReactNode;
  /** Top-level screens show the bottom nav. */
  nav?: boolean;
  children: ReactNode;
}

/** A phone screen: the dark app bar, the scrolling body, the pinned action and, on top-level screens, the nav. */
export function PhoneScreen({ title, subtitle, back, footer, nav = false, children }: PhoneScreenProps) {
  return (
    <div className="flex flex-1 flex-col bg-bg">
      <header className="bg-panel px-5 pt-10 pb-5 text-on-panel">
        {back && (
          <NavLink to={back.to} className="mb-2 flex items-center gap-2 text-xs font-semibold text-on-panel-muted">
            <Icon name="arrowLeft" className="size-4" />
            {back.label}
          </NavLink>
        )}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl leading-[1.3] font-semibold">{title}</h1>
          {nav && <NotificationsBell desktop={false} />}
        </div>
        {subtitle && <p className="mt-1 text-xs text-on-panel-muted">{subtitle}</p>}
      </header>
      <div className="flex flex-1 flex-col gap-4 px-4 py-4">{children}</div>
      {/* The action and the nav stick to the bottom edge together, the action above the nav. */}
      {(footer || nav) && (
        <div className="sticky bottom-0">
          {footer && <div className="border-t border-border bg-bg px-4 py-3">{footer}</div>}
          {nav && <PhoneNav />}
        </div>
      )}
    </div>
  );
}

/** Wraps the Store routes: the sidebar and top bar on desktop, nothing on phone (see PhoneScreen). */
export function StoreLayout({ children }: { children: ReactNode }) {
  const desktop = useIsDesktop();
  // The top bar's countdown keeps time by itself; this keeps the day in the page fresh too.
  useServerNow(60_000);
  useStoreFeed();
  if (!desktop) return <>{children}</>;
  return (
    <div className="flex min-h-0 flex-1">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col bg-bg">
        <TopBar />
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
