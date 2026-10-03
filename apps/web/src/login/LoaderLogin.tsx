import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useRoleLanguage } from "../i18n/language";
import { Logo } from "../ui/Logo";
import { Keypad, LanguageChips, PinDots } from "./pin";
import { QuickLoginChips } from "./QuickLoginChips";
import { PIN_LENGTH, usePinLogin } from "./usePinLogin";

/**
 * Loader sign-in. Figma `524:12439` (1280×800 landscape tablet): the form on the left and a large keypad on the
 * right, for gloved hands. Below `lg` it becomes one column with the keypad under the PIN (ADR 0002: the Loader
 * also works at phone width).
 */
export function LoaderLogin() {
  const { t } = useTranslation("loader/login");
  const language = useRoleLanguage("LOADER");
  const pin = usePinLogin("LOADER");

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void pin.signInWithPin();
  }

  const keypad = (className: string, keyClassName: string) => (
    <Keypad
      onDigit={pin.pressDigit}
      onBackspace={pin.backspace}
      backspaceLabel={t("pin.backspace")}
      className={className}
      keyClassName={keyClassName}
    />
  );

  return (
    <div data-theme="loader" lang={language} className="flex min-h-dvh flex-col lg:flex-row">
      <form
        onSubmit={onSubmit}
        className="flex w-full max-w-xl flex-1 flex-col justify-between gap-4 self-center p-4 short:gap-3 short:p-3 lg:w-[54.6875%] lg:max-w-[700px] lg:flex-none lg:gap-6 lg:self-auto lg:px-10 lg:py-14 xl:px-16"
      >
        <div className="flex flex-col gap-4 short:gap-3 lg:gap-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Logo panel="field" className="h-5 w-auto lg:h-[25px]" />
            <LanguageChips language={language} chipClassName="h-12 px-3 text-base lg:px-[18px] lg:text-lg" />
          </div>

          <div className="flex flex-col gap-1 lg:gap-2">
            <h1 className="text-[28px] leading-[1.25] font-bold short:text-2xl lg:text-[32px]">{t("title")}</h1>
            <p className="text-base text-muted short:hidden lg:text-xl">{t("subtitle")}</p>
          </div>

          <div className="flex flex-col gap-1.5 lg:gap-2">
            <label htmlFor="loader-id" className="text-base font-semibold text-muted lg:text-lg">
              {t("id.label")}
            </label>
            <input
              id="loader-id"
              name="username"
              autoComplete="username"
              autoCapitalize="characters"
              spellCheck={false}
              value={pin.loginId}
              onChange={(event) => pin.setLoginId(event.target.value)}
              onKeyDown={pin.onIdKeyDown}
              placeholder={t("id.placeholder")}
              className="h-16 rounded-2xl border-2 border-border bg-surface px-5 text-xl font-semibold text-text outline-primary placeholder:text-muted focus-visible:outline-2 short:h-14 lg:h-[72px]"
            />
          </div>

          <div className="flex flex-col gap-1.5 lg:gap-2">
            <p className="text-base font-semibold text-muted lg:text-lg">{t("pin.label")}</p>
            <PinDots
              filled={pin.pin.length}
              attempt={pin.attempt}
              label={t("pin.entered", { count: pin.pin.length, total: PIN_LENGTH })}
              className="h-16 gap-5 rounded-2xl border-2 px-5 short:h-14 lg:h-[72px]"
              dotClassName="size-5 border-2"
            />
            {pin.failure && (
              <p
                role="alert"
                className={`text-lg font-semibold ${pin.failure === "network" ? "text-warn-fg" : "text-danger-fg"}`}
              >
                {t(`errors.${pin.failure}`)}
              </p>
            )}
          </div>
        </div>

        {keypad("gap-2.5 short:gap-2 lg:hidden", "h-16 rounded-[20px] text-[32px] short:h-14")}

        <div className="flex flex-col gap-2.5 lg:gap-3.5">
          <button
            type="submit"
            disabled={!pin.canSubmit}
            className="h-16 rounded-[14px] bg-primary text-[22px] font-bold text-on-primary disabled:opacity-60 lg:h-20"
          >
            {t(pin.pending ? "submitting" : "submit")}
          </button>
          <p className="text-sm font-medium text-muted lg:text-base">
            <span className="hidden lg:inline">{t("offlineNote.tablet")}</span>
            <span className="lg:hidden">{t("offlineNote.phone")}</span>
          </p>
          <QuickLoginChips
            onSelect={pin.quickLogin}
            disabled={pin.pending}
            chipClassName="min-h-12 px-4 text-base"
            singleRow
          />
        </div>
      </form>

      {/* The keys are 140 px wide at the 1280 px frame and narrow with the pane on smaller tablets. */}
      <aside className="hidden flex-1 items-center justify-center bg-surface p-8 lg:flex xl:p-14">
        {keypad("w-full max-w-[452px] gap-4", "h-24 rounded-[20px] text-[40px]")}
      </aside>
    </div>
  );
}
