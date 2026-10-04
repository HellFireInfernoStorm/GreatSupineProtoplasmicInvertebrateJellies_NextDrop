import { loginRequestSchema } from "@nextdrop/contracts";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "../ui/Logo";
import { PasswordField } from "./PasswordField";
import { QuickLoginChips } from "./QuickLoginChips";
import { useLogin } from "./useLogin";
import { DEFAULT_DEPOT } from "../roles/dispatcher/depot";

/** The two depots of the network (data/reference/vehicles.csv). The reference API needs a session, so they are listed here. */
const DEPOTS = ["Peliyagoda", "Kandy"] as const;

const INPUT =
  "h-11 w-full rounded-lg border bg-surface px-3.5 text-sm text-text outline-link placeholder:text-faint focus-visible:outline-2";

/**
 * Dispatcher sign-in. Figma `523:17408`: navy panel beside the form, with the depot that scopes everything the
 * dispatcher sees. The Dispatcher is a desktop role; below `lg` the panel collapses to a logo bar.
 */
export function DispatcherLogin() {
  const { t } = useTranslation("dispatcher/login");
  const { pending, failure, submit, clearFailure } = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [depot, setDepot] = useState<(typeof DEPOTS)[number]>(DEFAULT_DEPOT);
  const [badFormat, setBadFormat] = useState(false);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const request = loginRequestSchema.safeParse({ role: "DISPATCHER", email: email.trim(), password, depot });
    // The browser accepts some addresses the contract rejects, such as `ops@depot`.
    if (!request.success) {
      setBadFormat(true);
      return;
    }
    void submit(request.data);
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
                setBadFormat(false);
                clearFailure();
              }}
              placeholder={t("email.placeholder")}
              aria-invalid={badFormat}
              aria-describedby={badFormat ? "dispatcher-email-error" : undefined}
              className={`${INPUT} ${badFormat ? "border-danger" : "border-border"}`}
            />
            {badFormat && (
              <p id="dispatcher-email-error" role="alert" className="text-xs text-danger">
                {t("errors.format")}
              </p>
            )}
          </div>

          <PasswordField
            id="dispatcher-password"
            label={t("password.label")}
            placeholder={t("password.placeholder")}
            showLabel={t("password.show")}
            hideLabel={t("password.hide")}
            value={password}
            onChange={(value) => {
              setPassword(value);
              clearFailure();
            }}
            error={failure && failure !== "network" ? t(`errors.${failure}`) : undefined}
            inputClassName={INPUT}
          />

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

          {/* "Keep me signed in" is drawn here in Figma. It is left out until the login contract has it (ADR 0031). */}
          <div className="flex justify-end">
            <a href="#dispatcher-help" className="text-sm font-semibold text-link">
              {t("forgot")}
            </a>
          </div>

          {/* No connection is amber, never red, and is not the password's fault. */}
          {failure === "network" && (
            <p role="alert" className="rounded-lg bg-warn-bg px-3 py-2 text-xs font-semibold text-warn-fg">
              {t("errors.network")}
            </p>
          )}

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
