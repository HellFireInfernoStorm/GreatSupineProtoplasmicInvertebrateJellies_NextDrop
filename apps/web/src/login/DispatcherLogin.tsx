import { loginRequestSchema } from "@nextdrop/contracts";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "../ui/Logo";
import { QuickLoginChips } from "./QuickLoginChips";
import { useLogin } from "./useLogin";

/** The two depots of the network (data/reference/vehicles.csv). The reference API needs a session, so they are listed here. */
const DEPOTS = ["Peliyagoda", "Kandy"] as const;

const INPUT =
  "h-11 w-full rounded-lg border bg-surface px-3.5 text-sm text-text outline-link placeholder:text-faint focus-visible:outline-2";

/** The 18 px checkbox of the Figma frames, drawn with tokens so it looks the same in every browser. */
const CHECKBOX =
  "relative size-[18px] shrink-0 appearance-none rounded-[5px] border-[1.5px] border-border bg-surface outline-link checked:border-primary checked:bg-primary focus-visible:outline-2 after:absolute after:top-px after:left-[5px] after:hidden after:h-2.5 after:w-[5px] after:rotate-45 after:border-r-2 after:border-b-2 after:border-on-primary checked:after:block";

/**
 * Dispatcher sign-in. Figma `523:17408`: navy panel beside the form, with the depot that scopes everything the
 * dispatcher sees. The Dispatcher is a desktop role; below `lg` the panel collapses to a logo bar.
 */
export function DispatcherLogin() {
  const { t } = useTranslation("dispatcher/login");
  const { pending, failure, submit, clearFailure } = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [depot, setDepot] = useState<(typeof DEPOTS)[number]>("Peliyagoda");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const request = loginRequestSchema.safeParse({ role: "DISPATCHER", email: email.trim(), password, depot });
    // The browser has already checked the email field, so a failure here is not expected.
    if (request.success) void submit(request.data);
  }

  return (
    <div data-theme="dispatcher" lang="en" className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="flex shrink-0 flex-col justify-between bg-panel px-6 py-5 lg:w-[640px] lg:p-16">
        <Logo panel="dispatcher" className="h-7 w-auto self-start lg:h-8" />
        <div className="hidden max-w-[512px] flex-col gap-4 lg:flex">
          <p className="text-[32px] leading-[1.2] font-bold text-on-panel">{t("pitch.title")}</p>
          <p className="text-[17px] leading-[1.3] font-semibold text-on-panel-muted">{t("pitch.body")}</p>
        </div>
        <p className="hidden text-[11px] text-on-panel-muted lg:block">
          {t("footer", { depot: t(`depot.options.${depot}`) })}
        </p>
      </aside>

      <main className="flex flex-1 items-center justify-center px-6 py-10">
        <form onSubmit={onSubmit} className="flex w-full max-w-[420px] flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] leading-[1.3] font-semibold tracking-[0.04em] text-ok uppercase">
              {t("eyebrow")}
            </p>
            <h1 className="text-[32px] leading-[1.2] font-bold tracking-[-0.01em]">{t("title")}</h1>
            <p className="text-sm text-muted">{t("subtitle")}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="dispatcher-email" className="text-xs font-semibold">
              {t("email.label")}
            </label>
            <input
              id="dispatcher-email"
              name="username"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                clearFailure();
              }}
              placeholder={t("email.placeholder")}
              className={`${INPUT} border-border`}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="dispatcher-password" className="text-xs font-semibold">
              {t("password.label")}
            </label>
            <div className="relative">
              <input
                id="dispatcher-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearFailure();
                }}
                placeholder={t("password.placeholder")}
                aria-invalid={failure !== null}
                aria-describedby={failure ? "dispatcher-login-error" : undefined}
                className={`${INPUT} pr-16 ${failure ? "border-danger" : "border-border"}`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((shown) => !shown)}
                className="absolute inset-y-0 right-3.5 text-sm font-semibold text-link"
              >
                {t(showPassword ? "password.hide" : "password.show")}
              </button>
            </div>
            {failure && (
              <p id="dispatcher-login-error" role="alert" className="text-xs text-danger">
                {t(`errors.${failure}`)}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="dispatcher-depot" className="text-xs font-semibold">
              {t("depot.label")}
            </label>
            <div className="relative">
              <select
                id="dispatcher-depot"
                value={depot}
                onChange={(event) => {
                  setDepot(event.target.value as (typeof DEPOTS)[number]);
                  clearFailure();
                }}
                className={`${INPUT} appearance-none border-border pr-9`}
              >
                {DEPOTS.map((option) => (
                  <option key={option} value={option}>
                    {t(`depot.options.${option}`)}
                  </option>
                ))}
              </select>
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-link"
              >
                ▾
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2.5 text-sm text-muted">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className={CHECKBOX}
              />
              {t("remember")}
            </label>
            <a href="#dispatcher-help" className="text-sm font-semibold text-link">
              {t("forgot")}
            </a>
          </div>

          <button
            type="submit"
            disabled={pending}
            className="h-12 rounded-[10px] bg-primary text-[13px] font-semibold text-on-primary disabled:opacity-60"
          >
            {t(pending ? "submitting" : "submit")}
          </button>

          {/* The chips hang below the form, so the form stays centred as it is drawn. */}
          <div className="relative">
            <p id="dispatcher-help" className="text-[11px] text-muted">
              {t("help.lockedOut")}
            </p>
            <div className="absolute inset-x-0 top-full pt-5">
              <QuickLoginChips onSelect={(request) => void submit(request)} disabled={pending} />
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
