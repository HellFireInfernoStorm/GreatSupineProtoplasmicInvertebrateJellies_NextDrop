import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type { ApiResponse } from "../../../lib/api";
import { callApi } from "../../../lib/api";
import { useServerNow } from "../../../lib/clock";
import { queryClient } from "../../../lib/queryClient";
import { formatDay, formatTime, sameDisplayDay } from "../../../lib/time";
import { Button, Sheet } from "../../../ui";
import { Icon } from "../icons";

type Notification = ApiResponse<"storeNotifications">["items"][number];

const KEY = ["store", "notifications"];

function useNotifications() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => callApi("storeNotifications", { query: { limit: 30 } }),
    refetchInterval: 30_000,
  });
}

async function markRead(body: { all: true } | { all: false; ids: string[] }): Promise<void> {
  try {
    await callApi("storeNotificationsRead", { body });
  } finally {
    // Read again either way, so the dots show what the server holds.
    void queryClient.invalidateQueries({ queryKey: KEY });
  }
}

/** The order a notification is about, if it is about one. */
const target = (item: Notification) => (item.entityRef.type === "order" ? `/store/orders/${item.entityRef.id}` : null);

function List({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("store/notifications");
  const navigate = useNavigate();
  const now = useServerNow(60_000);
  const notifications = useNotifications();
  const items = notifications.data?.items ?? [];
  const unread = notifications.data?.unreadCount ?? 0;
  const open = (item: Notification) => {
    if (item.readAt === null) void markRead({ all: false, ids: [item.id] });
    const to = target(item);
    onClose();
    if (to) void navigate(to);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">{unread > 0 ? t("unread", { count: unread }) : t("allRead")}</p>
        <Button variant="ghost" size="sm" disabled={unread === 0} onClick={() => void markRead({ all: true })}>
          {t("markAll")}
        </Button>
      </div>
      {notifications.isError ? (
        <p className="py-4 text-sm text-muted">{t("failed")}</p>
      ) : items.length === 0 && !notifications.isPending ? (
        <p className="py-4 text-sm text-muted">{t("none")}</p>
      ) : (
        <ul className="flex max-h-[60vh] flex-col divide-y divide-border overflow-y-auto">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => open(item)} className="flex w-full items-start gap-3 py-3 text-left">
                <span
                  aria-hidden="true"
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${item.readAt === null ? "bg-danger" : "bg-transparent"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${item.readAt === null ? "font-semibold" : ""}`}>
                    {item.readAt === null && <span className="sr-only">{t("unreadMark")} </span>}
                    {t(`kind.${item.kind}`, { ...item.params, defaultValue: t("kind.other") })}
                  </span>
                  <time dateTime={item.createdAt} className="mt-0.5 block text-xs text-muted">
                    {sameDisplayDay(item.createdAt, now.getTime())
                      ? formatTime(item.createdAt)
                      : `${formatDay(item.createdAt)} · ${formatTime(item.createdAt)}`}
                  </time>
                </span>
                {target(item) && <Icon name="chevronRight" className="mt-1 size-4 text-faint" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The bell and what it opens: a popover under the bell on desktop (Figma `438:1358`), a sheet on phone (`451:1367`,
 * all read `451:1577`). The red dot shows while anything is unread.
 */
export function NotificationsBell({ desktop }: { desktop: boolean }) {
  const { t } = useTranslation("store/notifications");
  const [open, setOpen] = useState(false);
  const unread = useNotifications().data?.unreadCount ?? 0;
  useEffect(() => {
    if (!open || !desktop) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, desktop]);
  const bell = (
    <button
      type="button"
      aria-label={unread > 0 ? t("bellUnread", { count: unread }) : t("bell")}
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
      className={`relative flex items-center justify-center rounded-full ${
        desktop ? "size-10 border border-border text-text" : "size-9 bg-panel-2"
      }`}
    >
      <Icon name="bell" className={desktop ? "size-5" : "size-[18px]"} />
      {unread > 0 && <span aria-hidden="true" className="absolute top-1.5 right-1.5 size-2 rounded-full bg-danger" />}
    </button>
  );
  if (!desktop) {
    return (
      <>
        {bell}
        {open && (
          <Sheet open onClose={() => setOpen(false)} title={t("title")}>
            <List onClose={() => setOpen(false)} />
          </Sheet>
        )}
      </>
    );
  }
  return (
    <div className="relative">
      {bell}
      {open && (
        <>
          {/* A click anywhere else closes the popover. */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <section
            aria-label={t("title")}
            className="absolute top-12 right-0 z-20 flex w-96 flex-col gap-2 rounded-2xl border border-border bg-surface p-5 shadow-lg"
          >
            <h2 className="text-lg font-semibold">{t("title")}</h2>
            <List onClose={() => setOpen(false)} />
          </section>
        </>
      )}
    </div>
  );
}
