import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ORDER_STATUSES } from "@nextdrop/contracts";
import { i18n } from "../../i18n";
import { toStrings } from "../../i18n/resources";
import en from "./locales/en.json";
import si from "./locales/si.json";
import ta from "./locales/ta.json";
import { Button } from "../Button";
import { StatusPill, FlagPill, ChilledPill, SyncPill } from "../StatusPill";
import { TripCard, StopCard } from "../Cards";
import { CapacityBar } from "../CapacityBar";
import { TimelineCard } from "../Timeline";
import { Banner } from "../Banner";
import { EmptyState } from "../EmptyState";
import { FormField } from "../FormField";
import { HoldToConfirm } from "../HoldToConfirm";
import { QuantityStepper } from "../QuantityStepper";
import { Modal, Sheet } from "../Overlay";
import { Toast } from "../Toast";
import "./gallery.css";

// This module is reachable only from the DEV lazy route. Sample copy stays outside eager locale discovery.
for (const [language, tree] of Object.entries({ en, si, ta })) {
  i18n.addResourceBundle(language, "shared/ui", toStrings(tree), true, true);
}
const themes = ["store", "dispatcher", "loader", "driver"] as const;
const variants = ["primary", "secondary", "ghost", "on-panel", "on-panel-outline", "ok", "warn", "danger"] as const;
const syncStates = ["offline", "saved", "sending", "synced", "seen"] as const;

export function Gallery() {
  const { t } = useTranslation("shared/ui");
  const [theme, setTheme] = useState<(typeof themes)[number]>("store");
  const [quantity, setQuantity] = useState(3);
  const [confirmed, setConfirmed] = useState(0);
  const [holdDisabled, setHoldDisabled] = useState(false);
  const [holdHidden, setHoldHidden] = useState(false);
  const [overlay, setOverlay] = useState<"modal" | "sheet" | null>(null);
  const [toast, setToast] = useState(false);
  const g = (key: string) => t(`gallery.${key}`);
  const overlayContent = (
    <>
      <p>{g("overlayBody")}</p>
      <Button onClick={() => setOverlay(null)}>{g("ok")}</Button>
    </>
  );
  return (
    <main className="nd-gallery" data-theme={theme} lang={i18n.resolvedLanguage}>
      <header className="nd-gallery-header">
        <h1>{g("title")}</h1>
        <p>{g("draft")}</p>
        <div className="nd-gallery-controls">
          <FormField id="gallery-theme" label={g("theme")}>
            <select value={theme} onChange={(event) => setTheme(event.target.value as (typeof themes)[number])}>
              {themes.map((value) => (
                <option key={value} value={value}>
                  {g(value)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="gallery-language" label={g("language")}>
            <select value={i18n.resolvedLanguage} onChange={(event) => void i18n.changeLanguage(event.target.value)}>
              {["en", "si", "ta"].map((value) => (
                <option key={value} value={value}>
                  {g(value)}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      </header>
      <section className="nd-gallery-section" aria-labelledby="buttons-title">
        <h2 id="buttons-title">{g("buttons")}</h2>
        <div className="nd-gallery-row">
          {variants.map((variant) => (
            <Button key={variant} variant={variant}>
              {g(variant)}
            </Button>
          ))}
          <Button size="sm">{g("secondary")}</Button>
          <Button size="lg">{g("primary")}</Button>
          <Button disabled>{g("disabled")}</Button>
          <Button loading>{t("loading")}</Button>
        </div>
      </section>
      <section className="nd-gallery-section" aria-labelledby="statuses-title">
        <h2 id="statuses-title">{g("statuses")}</h2>
        <div className="nd-gallery-row">
          {ORDER_STATUSES.map((status) => (
            <StatusPill key={status} status={status} />
          ))}
          <FlagPill flag="short" />
          <FlagPill flag="damaged" />
          <ChilledPill />
          {syncStates.map((state) => (
            <SyncPill key={state} state={state} />
          ))}
        </div>
      </section>
      <section className="nd-gallery-section" aria-labelledby="cards-title">
        <h2 id="cards-title">{g("cards")}</h2>
        <TripCard
          id="TRP001"
          vehicle={g("vehicle")}
          departure="2026-10-04T00:30:00Z"
          status="READY"
          changed={g("changed")}
        >
          <CapacityBar label={g("capacity")} used={8} capacity={12} unit={g("unit")} />
        </TripCard>
        <StopCard id="ORD001" outlet={g("outlet")} sequence={1} status="OUT_FOR_DELIVERY" eta="2026-10-04T01:30:00Z">
          <Button>{g("secondary")}</Button>
        </StopCard>
        <CapacityBar label={g("capacity")} used={14} capacity={12} unit={g("unit")} />
        <CapacityBar label={g("capacity")} used={11} capacity={12} unit={g("unit")} />
        <CapacityBar label={g("capacity")} used={0} capacity={0} unit={g("unit")} />
        <CapacityBar label={g("capacity")} used={0} unit={g("unit")} />
        <TimelineCard
          title={g("timeline")}
          events={[
            {
              id: "captured",
              title: g("delivered"),
              capturedAt: "2026-10-03T18:12:00Z",
              confirmedAt: "2026-10-04T02:10:00Z",
            },
            { id: "pending", title: g("pending"), capturedAt: "2026-10-04T02:20:00Z", confirmedAt: null },
          ]}
        />
      </section>
      <section className="nd-gallery-section" aria-labelledby="forms-title">
        <h2 id="forms-title">{g("forms")}</h2>
        <FormField id="gallery-note" label={g("field")} hint={g("hint")}>
          <input />
        </FormField>
        <FormField id="gallery-note-error" label={g("field")} error={g("error")} required>
          <input />
        </FormField>
        <QuantityStepper label={g("quantity")} value={quantity} onChange={setQuantity} min={0} max={12} />
      </section>
      <section className="nd-gallery-section" aria-labelledby="feedback-title">
        <h2 id="feedback-title">{g("feedback")}</h2>
        <Banner tone="warn" message={g("offline")} />
        <Banner
          tone="danger"
          urgent
          message={g("failure")}
          action={<Button variant="secondary">{g("retry")}</Button>}
        />
        <EmptyState title={g("empty")} detail={g("emptyDetail")} action={<Button>{g("secondary")}</Button>} />
      </section>
      <section className="nd-gallery-section" aria-labelledby="interactions-title">
        <h2 id="interactions-title">{g("interactions")}</h2>
        <p data-testid="confirmation-count">{t("gallery.confirmed", { count: confirmed })}</p>
        <div className="nd-gallery-row">
          <label>
            <input type="checkbox" checked={holdDisabled} onChange={(event) => setHoldDisabled(event.target.checked)} />{" "}
            {g("disableHold")}
          </label>
          <label>
            <input type="checkbox" checked={holdHidden} onChange={(event) => setHoldHidden(event.target.checked)} />{" "}
            {g("hideHold")}
          </label>
        </div>
        {!holdHidden && (
          <HoldToConfirm disabled={holdDisabled} onConfirm={() => setConfirmed((count) => count + 1)}>
            {g("hold")}
          </HoldToConfirm>
        )}
        <div className="nd-gallery-row">
          <Button data-testid="open-modal" onClick={() => setOverlay("modal")}>
            {g("showModal")}
          </Button>
          <Button data-testid="open-sheet" onClick={() => setOverlay("sheet")}>
            {g("showSheet")}
          </Button>
          <Button data-testid="open-toast" onClick={() => setToast(true)}>
            {g("showToast")}
          </Button>
        </div>
      </section>
      <Modal open={overlay === "modal"} onClose={() => setOverlay(null)} title={g("overlayTitle")}>
        {overlayContent}
      </Modal>
      <Sheet open={overlay === "sheet"} onClose={() => setOverlay(null)} title={g("overlayTitle")}>
        {overlayContent}
      </Sheet>
      <Toast
        open={toast}
        onClose={() => setToast(false)}
        message={g("saved")}
        action={
          <Button variant="ghost" onClick={() => setToast(false)}>
            {g("undo")}
          </Button>
        }
      />
    </main>
  );
}
