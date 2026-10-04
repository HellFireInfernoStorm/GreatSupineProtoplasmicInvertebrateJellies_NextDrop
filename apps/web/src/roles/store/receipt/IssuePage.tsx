import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { callApi } from "../../../lib/api";
import { useIsDesktop } from "../../../lib/layout";
import { formatTime } from "../../../lib/time";
import { Banner, Button, QuantityStepper } from "../../../ui";
import { useOrder } from "../data";
import { Icon } from "../icons";
import { PhoneScreen } from "../StoreLayout";
import { timelineSteps } from "../tracking/timeline";
import { canReport, ISSUE_KINDS, issueRequest, type IssueKind } from "./receipt";
import { useSend } from "./useSend";

/**
 * S3 Report an issue: short, damaged, warm or something else, about one item or the whole order. Phone: Figma
 * `235:1029`. Desktop draws it as a dialog (`234:893`); the build gives it a page of its own (ADR 0045).
 */
export function IssuePage() {
  const { t } = useTranslation("store/receipt");
  const { t: tDeliveries } = useTranslation("store/deliveries");
  const { id = "" } = useParams();
  const fieldId = useId();
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const detail = useOrder(id);
  const [kind, setKind] = useState<IssueKind>("SHORT");
  const [lineId, setLineId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const { pending, failure, send } = useSend();
  const home = `/store/orders/${id}`;

  if (detail.isError) return <Navigate to={home} replace />;
  if (!detail.data) return null;
  const { order } = detail.data;
  // An issue is about a delivery, so there must be one. A Disputed order can take another report: the server records
  // a second issue without changing the status (ADR 0045).
  if (!canReport(order.status)) return <Navigate to={home} replace />;

  const picked = order.lines.find((line) => line.id === (lineId ?? order.lines[0]!.id)) ?? order.lines[0]!;
  const whole = lineId === "";
  const max = Math.max(1, kind === "SHORT" ? picked.qtyOrdered : picked.qtyDelivered);
  const delivered = timelineSteps(detail.data.timeline).findLast((step) => step.kind === "delivered");
  const temp = tDeliveries(`temp.${order.tempRequirement}`);
  const subtitle = delivered
    ? t("issue.subtitleDelivered", { id: order.displayId, temp, time: formatTime(delivered.capturedAt) })
    : t("issue.subtitle", { id: order.displayId, temp });
  const submit = async () => {
    const body = issueRequest(kind, whole ? null : picked.id, Math.min(qty, max), note);
    const sent = await send(() => callApi("reportIssue", { params: { id }, body }));
    if (sent) void navigate(home, { replace: true });
  };

  const body = (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">{t("issue.what")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {ISSUE_KINDS.map((option) => (
            <label
              key={option}
              className={`flex h-12 cursor-pointer items-center justify-center rounded-xl border text-sm font-semibold has-focus-visible:outline-2 ${
                kind === option ? "border-primary bg-primary text-on-primary" : "border-border bg-surface"
              }`}
            >
              <input
                type="radio"
                name={`${fieldId}-kind`}
                className="sr-only"
                checked={kind === option}
                onChange={() => setKind(option)}
              />
              {t(`issue.kind.${option}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${fieldId}-item`} className="text-sm font-semibold">
          {t("issue.which")}
        </label>
        <select
          id={`${fieldId}-item`}
          aria-label={t("issue.item")}
          value={whole ? "" : picked.id}
          onChange={(event) => setLineId(event.target.value)}
          className="h-12 rounded-xl border border-border bg-surface-2 px-3 text-sm"
        >
          {order.lines.map((line) => (
            <option key={line.id} value={line.id}>
              {line.name} · {line.unitLabel}
            </option>
          ))}
          <option value="">{t("issue.wholeOrder")}</option>
        </select>
        {!whole && (
          <div className="flex items-center gap-3 [&_.nd-field]:gap-0">
            <QuantityStepper
              label={
                <span className="sr-only">
                  {t("issue.quantity", { product: `${picked.name} · ${picked.unitLabel}` })}
                </span>
              }
              value={Math.min(qty, max)}
              min={1}
              max={max}
              onChange={setQty}
            />
            <p className="text-xs text-muted">{t("issue.of", { count: picked.qtyDelivered })}</p>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${fieldId}-note`} className="text-sm font-semibold">
          {t("issue.note")}
        </label>
        <textarea
          id={`${fieldId}-note`}
          rows={3}
          maxLength={500}
          value={note}
          placeholder={t("issue.notePlaceholder")}
          onChange={(event) => setNote(event.target.value)}
          className="rounded-xl border border-border bg-surface-2 p-3 text-sm"
        />
      </div>
      {failure && <Banner tone="danger" urgent message={t(`issue.failed.${failure}`)} />}
    </>
  );
  const actions = (
    <div className="flex flex-col gap-2">
      <Button
        size="lg"
        className="w-full lg:w-auto lg:self-start"
        icon={<Icon name="send" />}
        loading={pending}
        onClick={() => void submit()}
      >
        {pending ? t("issue.sending") : t("issue.send")}
      </Button>
      <p className="text-xs text-muted">{t("issue.after")}</p>
    </div>
  );

  if (!desktop) {
    return (
      <PhoneScreen
        title={t("issue.title")}
        subtitle={subtitle}
        back={{ to: home, label: t("issue.back") }}
        footer={actions}
      >
        {body}
      </PhoneScreen>
    );
  }
  return (
    <main className="flex max-w-2xl flex-col gap-6 p-8">
      <div>
        <Link to={home} className="flex items-center gap-2 text-xs font-semibold text-muted">
          <Icon name="arrowLeft" className="size-4" />
          {t("issue.back")}
        </Link>
        <h1 className="mt-3 text-3xl leading-[1.25] font-bold tracking-[-0.01em]">{t("issue.title")}</h1>
        <p className="mt-2 text-sm text-muted">{subtitle}</p>
      </div>
      <section className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-6">
        {body}
        {actions}
      </section>
    </main>
  );
}
