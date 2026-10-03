import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useRoleLanguage } from "../i18n/language";
import { Logo } from "../ui/Logo";
import { Keypad, LanguageChips, PinDots } from "./pin";
import { QuickLoginChips } from "./QuickLoginChips";
import { PIN_LENGTH, usePinLogin } from "./usePinLogin";

/**
 * Driver sign-in. Figma `525:7860` (360×800): Driver ID, four PIN dots and an on-screen keypad, so the phone
 * keyboard never covers the button. The language chips are an addition to the frame (issue #36).
 */
export function DriverLogin() {
  const { t } = useTranslation("driver/login");
  const language = useRoleLanguage("DRIVER");
  const pin = usePinLogin("DRIVER");

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void pin.signInWithPin();
  }

  return (
    <div data-theme="driver" lang={language} className="flex min-h-dvh flex-col">
      <form
        onSubmit={onSubmit}
        className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-5 py-4 short:gap-3 short:py-3"
      >
        <Logo panel="field" className="h-[34px] w-auto self-start short:h-6" />

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-[32px] leading-[1.2] font-bold tracking-[-0.01em] short:text-[26px]">{t("title")}</h1>
            <p className="text-[15px] text-muted">{t("subtitle")}</p>
          </div>
          <LanguageChips language={language} chipClassName="h-12 px-3.5 text-[13px]" />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="driver-id" className="text-[13px] font-semibold text-muted">
            {t("id.label")}
          </label>
          <input
            id="driver-id"
            name="username"
            autoComplete="username"
            autoCapitalize="characters"
            spellCheck={false}
            value={pin.loginId}
            onChange={(event) => pin.setLoginId(event.target.value)}
            onKeyDown={pin.onIdKeyDown}
            placeholder={t("id.placeholder")}
            className="h-[52px] rounded-xl border-[1.5px] border-border bg-surface px-4 text-[15px] font-semibold text-text outline-primary placeholder:text-muted focus-visible:outline-2 short:h-12"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-[13px] font-semibold text-muted">{t("pin.label")}</p>
          <PinDots
            filled={pin.pin.length}
            attempt={pin.attempt}
            label={t("pin.entered", { count: pin.pin.length, total: PIN_LENGTH })}
            className="h-[52px] gap-4 rounded-xl border-[1.5px] px-4 short:h-12"
            dotClassName="size-3.5 border-[1.5px]"
          />
          {pin.failure && (
            <p
              role="alert"
              className={`text-[13px] font-semibold ${pin.failure === "network" ? "text-warn-fg" : "text-danger-fg"}`}
            >
              {t(`errors.${pin.failure}`)}
            </p>
          )}
        </div>

        <div className="min-h-4 flex-1 short:hidden" />

        <Keypad
          onDigit={pin.pressDigit}
          onBackspace={pin.backspace}
          backspaceLabel={t("pin.backspace")}
          className="gap-2"
          keyClassName="h-[52px] rounded-[14px] text-[28px] short:h-12"
        />

        <button
          type="submit"
          disabled={!pin.canSubmit}
          className="h-14 rounded-[14px] bg-primary text-[17px] font-bold text-on-primary disabled:opacity-60"
        >
          {t(pin.pending ? "submitting" : "submit")}
        </button>
        <p className="text-xs font-medium text-muted">{t("offlineNote.phone")}</p>
        <QuickLoginChips
          onSelect={pin.quickLogin}
          disabled={pin.pending}
          chipClassName="min-h-12 px-3.5 text-[13px]"
          singleRow
        />
      </form>
    </div>
  );
}
