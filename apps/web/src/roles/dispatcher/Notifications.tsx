import { useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Button, Modal, Banner } from "../../ui";
import { Instant } from "../../ui/Timeline";
import { callApi } from "../../lib/api";
import { notificationLink } from "./notification-links";

export function Notifications() {
  const { t } = useTranslation("dispatcher/planning");
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState("ALL");
  const query = useInfiniteQuery({
    queryKey: ["dispatch", "notifications"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      callApi("notifications", { query: { limit: 50, ...(pageParam ? { after: pageParam } : {}) }, signal }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 30_000,
  });
  const read = useMutation({
    mutationFn: (ids: string[] | null) =>
      callApi("notificationsRead", { body: ids ? { all: false, ids } : { all: true } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["dispatch", "notifications"] }),
  });
  const items =
    query.data?.pages
      .flatMap((p) => p.items)
      .filter((item, index, all) => all.findIndex((i) => i.id === item.id) === index) ?? [];
  const unread = query.data?.pages[0]?.unreadCount ?? 0;
  return (
    <>
      <Button
        variant="secondary"
        aria-label={`${t("notificationsTitle")} · ${t("unread", { count: unread })}`}
        onClick={() => setOpen(true)}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {unread > 0 && <span className="dispatch-unread-dot" />}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t("notificationsTitle")}>
        <div className="dispatch-notifications">
          <header>
            <span>{t("unread", { count: unread })}</span>
            <Button variant="ghost" disabled={!unread || read.isPending} onClick={() => read.mutate(null)}>
              {t("markAll")}
            </Button>
          </header>
          <div className="dispatch-notification-tabs" role="group" aria-label={t("notificationsTitle")}>
            {["ALL", "DELIVERIES", "PLANNING", "NEEDS_ACTION"].map((key) => (
              <button key={key} aria-pressed={group === key} onClick={() => setGroup(key)}>
                {t(`notificationGroups.${key}`)}
              </button>
            ))}
          </div>
          {(query.isError || read.isError) && (
            <Banner
              tone="warn"
              message={t("notificationsFailed")}
              action={
                <Button
                  variant="ghost"
                  onClick={() => {
                    read.reset();
                    void query.refetch();
                  }}
                >
                  {t("retry")}
                </Button>
              }
            />
          )}
          {items
            .filter((n) => group === "ALL" || n.group === group)
            .map((item) => {
              const link = notificationLink(
                item.entityRef,
                item.kind,
                typeof item.params.date === "string" ? item.params.date : undefined,
                typeof item.params.depot === "string" ? item.params.depot : undefined,
              );
              return (
                <article key={item.id} data-unread={!item.readAt}>
                  <strong>{t(item.titleKey, { ...item.params, defaultValue: t("notificationUnknown") })}</strong>
                  <p className="dispatch-muted">
                    <Instant instant={item.createdAt} />
                  </p>
                  {link && (
                    <Link
                      to={link}
                      onClick={() => {
                        if (!item.readAt) read.mutate([item.id]);
                        setOpen(false);
                      }}
                    >
                      {t("openNotification")} →
                    </Link>
                  )}
                </article>
              );
            })}
          {!query.isPending && !query.isError && !items.some((n) => group === "ALL" || n.group === group) && (
            <p>{t("noNotifications")}</p>
          )}
          {query.isPending && <p>{t("loading")}</p>}
          {query.hasNextPage && (
            <Button
              variant="secondary"
              loading={query.isFetchingNextPage}
              onClick={() => {
                void query.fetchNextPage();
              }}
            >
              {t("more")}
            </Button>
          )}
        </div>
      </Modal>
    </>
  );
}
