import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../lib/session";
import { fieldRepository } from "../../sync";
import { Banner, Button, Sheet } from "../../ui";
import { loaderPlanKey } from "./drafts";
import type { LoaderData } from "./data";
import { ReceiptStatus } from "./parts";
export function PlanReview({ data }: { data: LoaderData }) {
  const { t } = useTranslation("loader/dock");
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const snapshot = data.snapshot;
  const current = snapshot?.planVersion;
  const receipt = data.receipts.find(
    (r) => r.kind === "PLAN_ACK" && r.id.startsWith("loader-ack:") && r.planVersion === current,
  );
  const events = receipt?.events.map((e) => data.events.find((r) => r.clientEventId === e.clientEventId) ?? e) ?? [];
  const accepted =
    !!snapshot &&
    events.some(
      (e) =>
        e.state === "acked" &&
        e.confirmationFeedHead !== undefined &&
        BigInt(e.confirmationFeedHead) <= BigInt(snapshot.feedCursor),
    );
  useEffect(() => {
    if (accepted && snapshot) void fieldRepository.db.set(loaderPlanKey(user.id, snapshot), snapshot.planVersion);
  }, [accepted, snapshot, user.id]);
  const stale = data.drafts.filter((d) => d.receipt.planVersion !== current);
  if (
    !snapshot ||
    current === null ||
    current === undefined ||
    (current === data.baseline && !stale.length) ||
    (accepted && !stale.length)
  )
    return null;
  const acknowledge = async () => {
    if (busy || receipt || stale.length) return;
    setBusy(true);
    setError(false);
    try {
      await fieldRepository.enqueueBatch(
        [
          {
            type: "PLAN_ACKNOWLEDGED",
            subject: snapshot.scope.trips[0] ? { tripId: snapshot.scope.trips[0].id } : {},
            actor: { userId: user.id, role: "LOADER" },
            payload: { planVersion: current },
          },
        ],
        {
          id: `loader-ack:${loaderPlanKey(user.id, snapshot)}:${current}`,
          userId: user.id,
          resetEpoch: snapshot.resetEpoch,
          date: snapshot.scope.date,
          tripId: snapshot.scope.trips[0]?.id ?? "",
          kind: "PLAN_ACK",
          planVersion: current,
        },
      );
      setOpen(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Banner
        tone="warn"
        message={t(stale.length ? "staleDraft" : receipt ? "ackPending" : "planChanged")}
        action={
          <Button variant="ghost" onClick={() => setOpen(true)}>
            {t("reviewPlan")}
          </Button>
        }
      />
      <Sheet open={open} onClose={() => setOpen(false)} title={t("planChanged")}>
        {error && <Banner tone="warn" message={t("saveError")} />}
        <p>{t("reviewVersion", { version: current })}</p>
        {snapshot.scope.trips.map((trip) => (
          <section className="loader-card" key={trip.id}>
            <h3>{trip.displayId}</h3>
            {[...trip.stops]
              .sort((a, b) => b.seq - a.seq)
              .map((stop) => (
                <p key={stop.id}>
                  {t("stopNumber", { number: stop.seq })} · {stop.outlet.displayId} · {stop.outlet.name}
                </p>
              ))}
          </section>
        ))}
        {!snapshot.scope.trips.length && <p>{t("noTrips")}</p>}
        {stale.map((draft) => (
          <section className="loader-card" key={draft.key}>
            <p>{t("staleDraft")}</p>
            <p>{draft.label}</p>
            <Button
              variant="secondary"
              onClick={() =>
                void fieldRepository.db
                  .transaction("rw", fieldRepository.db.meta, async () => {
                    const saved = await fieldRepository.db.value<typeof draft>(draft.key);
                    if (saved?.receipt.userId === user.id) await fieldRepository.db.meta.delete(draft.key);
                  })
                  .catch(() => setError(true))
              }
            >
              {t("discardDraft")}
            </Button>
          </section>
        ))}
        {receipt ? (
          <ReceiptStatus receipt={receipt} data={data} />
        ) : (
          <Button size="lg" variant="ok" loading={busy} disabled={!!stale.length} onClick={() => void acknowledge()}>
            {t("acceptPlan")}
          </Button>
        )}
      </Sheet>
    </>
  );
}
