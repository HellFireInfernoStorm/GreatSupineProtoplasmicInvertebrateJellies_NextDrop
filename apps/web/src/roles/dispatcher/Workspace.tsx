import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { Button, Banner, Toast } from "../../ui";
import { callApi, ApiRequestError } from "../../lib/api";
import { usePlanningData, type PlanningQueries } from "./data";
import { makeReference, evaluate, validationContext, type DraftData } from "./planning";
import { DraftSession } from "./draft-session";
import { Dashboard } from "./Dashboard";
import { OrderQueue } from "./OrderQueue";
import { PlanBoard } from "./PlanBoard";
import { ValidationChecks } from "./ValidationChecks";

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}
export function Workspace({ depot, date }: { depot: string; date: string }) {
  const { t } = useTranslation("dispatcher/planning");
  const queries = usePlanningData(depot, date);
  const required = [queries.day, queries.draft, queries.outlets, queries.vehicles, queries.calendar, queries.fleet];
  if (required.some((query) => !query.data))
    return (
      <section className="dispatch-card">
        <p role="status">{t(required.some((q) => q.isError) ? "loadFailed" : "loading")}</p>
        {required.some((q) => q.isError) && (
          <Button
            onClick={() => {
              for (const query of required) void query.refetch();
            }}
          >
            {t("retry")}
          </Button>
        )}
      </section>
    );
  return <Editor key={`${depot}|${date}`} queries={queries} depot={depot} date={date} />;
}

function Editor({ queries, depot, date }: { queries: PlanningQueries; depot: string; date: string }) {
  const queryClient = useQueryClient();
  const { t } = useTranslation("dispatcher/planning");
  const { pathname } = useLocation();
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const day = queries.day.data!;
  const outlets = queries.outlets.data!.items;
  const vehicles = queries.vehicles.data!.items.filter((v) => v.depot === depot);
  const workshop = queries.fleet
    .data!.items.filter((item) => item.vehicle.depot === depot && item.availability.status === "IN_WORKSHOP")
    .map((item) => item.vehicle);
  const unavailable = new Set(workshop.map((v) => v.displayId));
  const reference = makeReference(outlets, vehicles, queries.calendar.data!.items);
  const context = validationContext(day.planningContext, reference);
  const [editor] = useState(
    () =>
      new DraftSession(
        queries.draft.data!.draft,
        day.queue.map((o) => o.id),
      ),
  );
  const snapshot = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  const [toast, setToast] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editPath, setEditPath] = useState(pathname);
  if (editPath !== pathname) {
    setEditPath(pathname);
    setEditing(false);
  }
  const lastSynced = useRef(queries.draft.data);
  useEffect(() => {
    const incoming = queries.draft.data;
    if (
      !incoming ||
      incoming === lastSynced.current ||
      editing ||
      snapshot.busy ||
      snapshot.candidate ||
      snapshot.error
    )
      return;
    lastSynced.current = incoming;
    if ((incoming.draft?.revision ?? 0) < (snapshot.draft?.revision ?? 0)) return;
    editor.replace(
      incoming.draft,
      day.queue.map((order) => order.id),
    );
  }, [
    queries.draft.data,
    editing,
    snapshot.busy,
    snapshot.candidate,
    snapshot.error,
    snapshot.draft,
    editor,
    day.queue,
  ]);
  const writable = ["CLOSED", "PLANNING", "PUBLISHED", "IN_PROGRESS"].includes(day.state);
  const networkFailed = [
    queries.day,
    queries.draft,
    queries.outlets,
    queries.vehicles,
    queries.calendar,
    queries.fleet,
  ].some((q) => q.isError);
  const disabled =
    !writable || !online || networkFailed || snapshot.busy || !!snapshot.error || snapshot.candidate !== null;
  const page = pathname.split("/")[2] || "dashboard";

  async function save(data: DraftData) {
    if (!writable || !online || networkFailed || snapshot.busy || snapshot.error) return false;
    const local = evaluate(data, day.queue, date, reference, unavailable, context);
    if (!local.ok) return false;
    const ok = await editor.persist(data, {
      validate: (candidate) => callApi("validate", { params: { date }, query: { depot }, body: { data: candidate } }),
      save: async (candidate, revision) => {
        const response = await callApi("saveDraft", {
          params: { date },
          query: { depot },
          body: { data: candidate, revision },
        });
        if (!response.draft) throw new Error("Missing saved draft");
        return response.draft;
      },
    });
    if (ok) {
      queryClient.setQueryData(["dispatch", depot, date, "draft"], { draft: editor.getSnapshot().draft });
      setToast((value) => value + 1);
      void queries.day.refetch();
    }
    if (
      editor.getSnapshot().error instanceof ApiRequestError &&
      (editor.getSnapshot().error as ApiRequestError).code === "ILLEGAL_TRANSITION"
    )
      void queries.day.refetch();
    return ok;
  }
  async function propose() {
    if (disabled || editing) return;
    const ok = await editor.propose(
      async (revision) => (await callApi("propose", { params: { date }, query: { depot }, body: { revision } })).draft,
    );
    if (ok) {
      queryClient.setQueryData(["dispatch", depot, date, "draft"], { draft: editor.getSnapshot().draft });
      setToast((value) => value + 1);
      void queries.day.refetch();
    }
  }
  async function reload() {
    const result = await queries.draft.refetch();
    if (result.isSuccess && result.data) {
      setEditing(false);
      editor.replace(
        result.data.draft,
        day.queue.map((o) => o.id),
      );
    }
    void queries.day.refetch();
  }
  const conflict = snapshot.error instanceof ApiRequestError && snapshot.error.code === "REVISION_CONFLICT";
  return (
    <>
      {!online || networkFailed ? (
        <Banner tone="warn" message={t("offline")} />
      ) : !writable ? (
        <Banner tone="info" message={t("readOnly")} />
      ) : null}
      {(!!snapshot.error || (snapshot.candidate !== null && !snapshot.busy)) && (
        <Banner
          tone="warn"
          message={t(conflict ? "conflict" : "saveFailed")}
          detail={snapshot.candidate ? t("candidateKept") : t("checkLatest")}
          action={
            <Button
              variant="secondary"
              disabled={snapshot.busy || queries.draft.isFetching}
              onClick={() => {
                void reload();
              }}
            >
              {t("reload")}
            </Button>
          }
        />
      )}
      {snapshot.validation && !snapshot.validation.ok && (
        <section className="dispatch-card">
          <ValidationChecks result={snapshot.validation} serverVerified />
        </section>
      )}
      <div className="dispatch-page-actions">
        <Button
          variant="secondary"
          disabled={snapshot.busy}
          onClick={() => {
            void reload();
            for (const q of [queries.fleet, queries.outlets, queries.vehicles, queries.calendar]) void q.refetch();
          }}
        >
          {t("refresh")}
        </Button>
        {["dashboard", "queue", "plan"].includes(page) && (
          <Button
            loading={snapshot.busy}
            disabled={disabled || editing}
            onClick={() => {
              void propose();
            }}
          >
            {t("propose")}
          </Button>
        )}
      </div>
      {page === "dashboard" ? (
        <Dashboard
          day={day}
          data={snapshot.data}
          vehicles={vehicles}
          outlets={outlets}
          workshop={workshop}
          runs={queries.runs.data ?? null}
          exceptions={queries.exceptions.data ?? null}
        />
      ) : page === "queue" ? (
        <OrderQueue day={day} outlets={outlets} vehicles={vehicles.filter((v) => !unavailable.has(v.displayId))} />
      ) : page === "plan" ? (
        <PlanBoard
          key={snapshot.generation}
          data={snapshot.data}
          orders={day.queue}
          outlets={outlets}
          vehicles={vehicles}
          reference={reference}
          context={context}
          unavailable={unavailable}
          date={date}
          disabled={disabled}
          busy={snapshot.busy}
          onSave={save}
          onEditingChange={setEditing}
        />
      ) : (
        <section className="dispatch-card">
          <p>{t("handoff")}</p>
        </section>
      )}
      <Toast open={toast > 0} notificationId={toast} onClose={() => setToast(0)} message={t("saved")} />
    </>
  );
}
