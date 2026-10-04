import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { OrderDto } from "@nextdrop/contracts";
import { useSession } from "../../lib/session";
import { clockOffsetMs, useServerNow } from "../../lib/clock";
import { fieldRepository } from "../../sync";
import { Banner, Button, Sheet } from "../../ui";
import type { LoaderData } from "./data";
import { latestReceipt, receiptMatches, canRetry, receiptCovered } from "./model";
import { reversalKey, saveDraft, undoDraft } from "./drafts";
import { ReceiptStatus } from "./parts";

function ReversalTask({ order, data }: { order: OrderDto; data: LoaderData }) {
  const { t } = useTranslation("loader/reversal");
  const { user } = useSession();
  const deviceNow = useServerNow(250).getTime() - clockOffsetMs();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const snapshot = data.snapshot!;
  const state = data.states[order.id];
  const prefix = reversalKey(user.id, snapshot, order.id);
  const draft = data.drafts.find((d) => receiptMatches(d.receipt, prefix));
  const receipt = latestReceipt(data.receipts, prefix);
  const locked =
    !state?.pendingReversal ||
    !!draft ||
    busy ||
    snapshot.planVersion === null ||
    (!!receipt && !canRetry(receipt, data.events) && !receiptCovered(receipt, data.events, snapshot.feedCursor));
  const confirm = async () => {
    if (locked || !state || snapshot.planVersion === null) return;
    setBusy(true);
    setError(false);
    try {
      await saveDraft(fieldRepository, {
        label: order.displayId,
        receipt: {
          id: prefix,
          userId: user.id,
          resetEpoch: snapshot.resetEpoch,
          date: snapshot.scope.date,
          tripId: order.assignment?.tripId ?? "",
          orderId: order.id,
          kind: "LOAD_REVERSED",
          planVersion: snapshot.planVersion,
        },
        intents: [
          {
            type: "LOAD_REVERSED",
            actor: { userId: user.id, role: "LOADER" },
            // The task survives removal from a trip; do not require a current assignment.
            subject: { orderId: order.id },
            payload: { orderId: order.id, lines: state.loaded.map((line) => ({ ...line })) },
          },
        ],
        capturedAt: new Date().toISOString(),
        clockOffsetMs: clockOffsetMs(),
      });
      setOpen(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="loader-card loader-order">
      <h3>{order.displayId}</h3>
      <p>{t("instruction")}</p>
      <p className="loader-muted">{t(`target.${order.pendingReversal!.to}`)}</p>
      {error && <Banner tone="warn" message={t("saveError")} />}
      <Button variant="secondary" size="lg" disabled={locked} onClick={() => setOpen(true)}>
        {t("review")}
      </Button>
      {draft && (
        <div className="loader-receipt">
          <p>{t("draftSaved")}</p>
          <Button
            variant="secondary"
            disabled={deviceNow >= draft.expiresAt}
            onClick={() => void undoDraft(fieldRepository, draft.key, user.id).catch(() => setError(true))}
          >
            {t("undo")}
          </Button>
        </div>
      )}
      {receipt && <ReceiptStatus receipt={receipt} data={data} />}
      <Sheet
        open={open}
        title={t("confirmTitle", { order: order.displayId })}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
      >
        <p>{t("instruction")}</p>
        <ul>
          {order.lines.map((line) => (
            <li key={line.id}>
              {t("line", {
                name: line.name,
                quantity: state?.loaded.find((l) => l.lineId === line.id)?.qtyLoaded ?? line.qtyLoaded,
              })}
            </li>
          ))}
        </ul>
        {error && <Banner tone="warn" message={t("saveError")} />}
        <Button variant="ok" size="lg" loading={busy} disabled={locked} onClick={() => void confirm()}>
          {t("confirm")}
        </Button>
      </Sheet>
    </section>
  );
}

export function Reversals({ data }: { data: LoaderData }) {
  const { t } = useTranslation("loader/reversal");
  const orders = data.snapshot?.scope.reversals ?? [];
  if (!orders.length) return null;
  return (
    <section className="loader-rows" aria-label={t("title")}>
      <h2>{t("title")}</h2>
      {orders.map((order) => (
        <ReversalTask key={order.id} order={order} data={data} />
      ))}
    </section>
  );
}
