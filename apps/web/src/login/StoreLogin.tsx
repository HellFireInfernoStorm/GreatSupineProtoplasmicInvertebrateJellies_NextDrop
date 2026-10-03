import { loginRequestSchema } from "@nextdrop/contracts";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useClockSynced, useServerNow } from "../lib/clock";
import { formatDay } from "../lib/time";
import { Logo } from "../ui/Logo";
import { PasswordField } from "./PasswordField";
import { QuickLoginChips } from "./QuickLoginChips";
import { useLogin } from "./useLogin";

const INPUT =
  "h-[46px] w-full rounded-[10px] border bg-surface px-3.5 text-sm text-text outline-link placeholder:text-faint focus-visible:outline-2";

/**
 * Store manager sign-in. Figma: desktop `523:9162` (navy brand panel beside the form) and phone `523:9199`
 * (dark header with the form on a white sheet). One form serves both; the layout switches at the `lg` breakpoint.
 */
export function StoreLogin() {
  const { t } = useTranslation("store/login");
  const today = useServerNow(60_000);
  // Before sign-in no response has carried the server's time yet, and the demo clock can sit a day away from the
  // device clock. The date is shown only once the server clock is known.
  const clockSynced = useClockSynced();
  const { pending, failure, submit, clearFailure } = useLogin();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [forgot, setForgot] = useState(false);
  const [badFormat, setBadFormat] = useState(false);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = loginId.trim();
    // Outlet IDs are upper case (OUT015); emails are left as typed.
    const request = loginRequestSchema.safeParse({
      role: "STORE",
      loginId: trimmed.includes("@") ? trimmed : trimmed.toUpperCase(),
      password,
    });
    if (!request.success) {
      setBadFormat(true);
      return;
    }
    void submit(request.data);
  }

  const forgotButton = (className: string) => (
    <button
      type="button"
      onClick={() => setForgot(true)}
      className={`-my-3 py-3 text-sm font-semibold text-link ${className}`}
    >
      {t("forgot")}
    </button>
  );

  return (
    <div data-theme="store" lang="en" className="flex min-h-dvh flex-col bg-panel lg:flex-row lg:bg-bg">
      <aside className="hidden w-[560px] shrink-0 flex-col justify-between bg-panel p-14 lg:flex">
        <Logo panel="store" className="h-8 w-auto self-start" />
        <div className="flex max-w-[448px] flex-col gap-3.5">
          <p className="text-4xl leading-[1.2] font-bold text-on-panel">{t("pitch.title")}</p>
          <p className="text-base leading-[1.4] font-semibold text-on-panel-muted">{t("pitch.body")}</p>
        </div>
        <p className="text-xs text-on-panel-muted">{t("footer")}</p>
      </aside>

      {/* Below `lg` the phone design is used. On a tablet held upright it keeps its phone width and is centred. */}
      <header className="px-6 pt-16 pb-9 short:pt-6 short:pb-5 lg:hidden">
        <div className="mx-auto flex w-full max-w-md flex-col gap-2.5">
          <Logo panel="store" className="h-5 w-auto self-start" />
          <h1 className="text-3xl leading-[1.25] font-bold text-on-panel">{t("title")}</h1>
          <p className="text-sm text-on-panel-muted">
            {clockSynced ? t("phoneSubtitle", { date: formatDay(today) }) : t("eyebrow")}
          </p>
        </div>
      </header>

      <main className="flex flex-1 flex-col rounded-t-[28px] bg-bg px-6 pt-7 pb-8 lg:items-center lg:justify-center lg:rounded-none lg:p-0">
        <form
          onSubmit={onSubmit}
          className="mx-auto flex w-full max-w-md flex-1 flex-col gap-[18px] lg:w-[400px] lg:flex-none lg:gap-5"
        >
          <div className="hidden flex-col gap-1.5 lg:flex">
            <p className="text-[11px] leading-[1.3] font-semibold tracking-[0.06em] text-ok uppercase">
              {t("eyebrow")}
            </p>
            <h1 className="text-3xl leading-[1.25] font-bold tracking-[-0.01em]">{t("title")}</h1>
            <p className="text-sm text-muted">{t("subtitle")}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="store-login-id" className="text-xs font-semibold">
              {t("loginId.label")}
            </label>
            <input
              id="store-login-id"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={loginId}
              onChange={(event) => {
                setLoginId(event.target.value);
                setBadFormat(false);
                clearFailure();
              }}
              placeholder={t("loginId.placeholder")}
              aria-invalid={badFormat}
              aria-describedby={badFormat ? "store-login-id-error" : undefined}
              className={`${INPUT} ${badFormat ? "border-danger" : "border-border"}`}
            />
            {badFormat && (
              <p id="store-login-id-error" role="alert" className="text-xs text-danger">
                {t("errors.format")}
              </p>
            )}
          </div>

          <PasswordField
            id="store-password"
            label={t("password.label")}
            placeholder={t("password.placeholder")}
            showLabel={t("password.show")}
            hideLabel={t("password.hide")}
            value={password}
            onChange={(value) => {
              setPassword(value);
              clearFailure();
            }}
            error={
              failure && failure !== "network"
                ? t(`errors.${failure === "forbidden" ? "unknown" : failure}`)
                : undefined
            }
            inputClassName={INPUT}
          />

          {/* "Keep me signed in" is drawn here in Figma. It is left out until the login contract has it (ADR 0031). */}
          <div className="hidden justify-end lg:flex">{forgotButton("")}</div>

          {/* No connection is amber, never red, and is not the password's fault. */}
          {failure === "network" && (
            <p role="alert" className="rounded-lg bg-warn-bg px-3 py-2 text-xs font-semibold text-warn-fg">
              {t("errors.network")}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="h-[52px] rounded-[10px] bg-primary text-base font-semibold text-on-primary disabled:opacity-60"
          >
            {t(pending ? "submitting" : "submit")}
          </button>

          {forgotButton("self-start lg:hidden")}

          {/* On the desktop the chips hang below the form, so the form stays centred as it is drawn. */}
          <div className="mt-auto flex flex-col gap-4 lg:relative lg:mt-0">
            <p className="text-xs leading-[1.5] text-muted">{t(forgot ? "help.forgot" : "help.noAccount")}</p>
            <div className="lg:absolute lg:inset-x-0 lg:top-full lg:pt-5">
              <QuickLoginChips onSelect={(request) => void submit(request)} disabled={pending} />
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
