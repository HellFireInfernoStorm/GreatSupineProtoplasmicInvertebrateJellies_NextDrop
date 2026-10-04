import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { callApi } from "../../../lib/api";
import { useIsDesktop } from "../../../lib/layout";
import { formatTime } from "../../../lib/time";
import { Banner, Button, QuantityStepper, StatusPill } from "../../../ui";
import { useDeliveries, useOrder } from "../data";
import { orderUnits } from "../deliveries/model";
import { Icon } from "../icons";
import { PhoneScreen } from "../StoreLayout";
import { timelineSteps, type OrderDetail } from "../tracking/timeline";
import { asDelivered, receiptRequest, receivedQty } from "./receipt";
import { useSend } from "./useSend";

/** The driver's record the counts are pre-filled from: both delivery times, the trip, and who signed. */
function DriverRecord({ detail }: { detail: OrderDetail }) {
  const { t } = useTranslation("store/receipt");
  const { order } = detail;
  const steps = timelineSteps(detail.timeline);
  const delivered = steps.findLast((step) => step.kind === "delivered");
  const proof = steps.findLast((step) => step.kind === "proof");
  const trip = useDeliveries(order.currentDate).data?.items.find((item) => item.order.id === order.id)?.trip;
  const row = (icon: ReactNode, main: string, sub?: string) => (
    <li className="flex items-start gap-3">
      {icon}
      <span>
        <span className="block text-sm font-semibold">{main}</span>
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </span>
    </li>
  );
  return (
    <section className="flex flex-col gap-2.5 rounded-xl bg-surface-2 p-3">
      <h2 className="text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">{t("receipt.record")}</h2>
      <ul className="flex flex-col gap-2">
        {delivered &&
          row(
            <Icon name="clock" className="size-5 text-muted" />,
            t("receipt.delivered", { time: formatTime(delivered.capturedAt) }),
            t("receipt.confirmed", { time: formatTime(delivered.confirmedAt) }),
          )}
        {trip &&
          order.assignment &&
          row(
            <Icon name="truck" className="size-5 text-muted" />,
            t("receipt.trip", { trip: trip.displayId, seq: order.assignment.seq }),
          )}
        {proof &&
          row(
            <Icon name="checkCircle" className="size-5 text-muted" />,
            t("receipt.signed", { name: proof.params.name, count: Number(proof.params.count) }),
          )}
      </ul>
    </section>
  );
}

/**
 * S3 Confirm receipt: per-line steppers pre-filled from the driver's record. Phone: Figma `235:944`. Desktop draws
 * it as a dialog (`234:803`); the build gives it a page of its own (ADR 0045).
 */
export function ReceiptPage() {
  const { t } = useTranslation("store/receipt");
  const { t: tDeliveries } = useTranslation("store/deliveries");
  const { id = "" } = useParams();
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const detail = useOrder(id);
  const [counted, setCounted] = useState<Record<string, number>>({});
  const { pending, failure, send } = useSend();
  const home = `/store/orders/${id}`;

  if (detail.isError) return <Navigate to={home} replace />;
  if (!detail.data) return null;
  const { order } = detail.data;
  // Receipt can be confirmed once, and only after the driver's record has arrived.
  if (order.status !== "DELIVERED" && !pending) return <Navigate to={home} replace />;

  const units = orderUnits(order);
  const same = asDelivered(order, counted);
  const confirm = async () => {
    const sent = await send(() => callApi("receipt", { params: { id }, body: receiptRequest(order, counted) }));
    if (sent) void navigate(home, { replace: true });
  };
  const subtitle = `${order.displayId} · ${tDeliveries(`temp.${order.tempRequirement}`)}`;
  const body = (
    <>
      <DriverRecord detail={detail.data} />
      <ul className="flex flex-col gap-3">
        {order.lines.map((line) => (
          <li key={line.id} className="flex flex-col gap-3 rounded-xl border border-border p-4">
            <div>
              <p className="text-sm font-semibold">
                {line.name} · {line.unitLabel}
              </p>
              <p className="mt-1 text-xs text-muted">
                {t("receipt.line", { ordered: line.qtyOrdered, delivered: line.qtyDelivered })}
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 [&_.nd-field]:gap-0">
              <p className="text-xs font-semibold">{t("receipt.youReceived")}</p>
              <QuantityStepper
                label={
                  <span className="sr-only">
                    {t("receipt.quantity", { product: `${line.name} · ${line.unitLabel}` })}
                  </span>
                }
                value={receivedQty(order, counted, line.id)}
                min={0}
                max={line.qtyOrdered}
                onChange={(value) => setCounted((current) => ({ ...current, [line.id]: value }))}
              />
            </div>
          </li>
        ))}
      </ul>
      {units.short > 0 && (
        <Banner
          tone="warn"
          icon={<Icon name="flag" />}
          message={t("receipt.short", { count: units.short, expected: units.expected, ordered: units.ordered })}
        />
      )}
      {!same && <Banner tone="info" message={t("receipt.differs")} />}
      {failure && <Banner tone="danger" urgent message={t(`receipt.failed.${failure}`)} />}
    </>
  );
  const actions = (
    <div className="flex flex-col gap-2 lg:flex-row">
      <Button
        size="lg"
        className="w-full lg:w-auto"
        icon={<Icon name="checkCircle" />}
        loading={pending}
        onClick={() => void confirm()}
      >
        {pending ? t("receipt.sending") : same ? t("receipt.asDelivered") : t("receipt.asCounted")}
      </Button>
      <Button
        size="lg"
        variant="secondary"
        className="w-full lg:w-auto"
        icon={<Icon name="flag" />}
        disabled={pending}
        onClick={() => void navigate(`${home}/issue`)}
      >
        {t("receipt.report")}
      </Button>
    </div>
  );

  if (!desktop) {
    return (
      <PhoneScreen
        title={t("receipt.title")}
        subtitle={subtitle}
        back={{ to: home, label: t("receipt.back") }}
        footer={actions}
      >
        <div>
          <StatusPill status={order.status} />
        </div>
        {body}
      </PhoneScreen>
    );
  }
  return (
    <main className="flex max-w-2xl flex-col gap-6 p-8">
      <div>
        <Link to={home} className="flex items-center gap-2 text-xs font-semibold text-muted">
          <Icon name="arrowLeft" className="size-4" />
          {t("receipt.back")}
        </Link>
        <div className="mt-3 flex items-center gap-4">
          <h1 className="text-3xl leading-[1.25] font-bold tracking-[-0.01em]">{t("receipt.title")}</h1>
          <StatusPill status={order.status} />
        </div>
        <p className="mt-2 text-sm text-muted">{subtitle}</p>
      </div>
      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6">
        {body}
        {actions}
      </section>
    </main>
  );
}
