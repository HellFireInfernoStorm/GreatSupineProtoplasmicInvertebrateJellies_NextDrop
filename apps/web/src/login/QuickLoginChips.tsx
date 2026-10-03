import type { LoginRequest } from "@nextdrop/contracts";
import { useTranslation } from "react-i18next";
import { DEMO_MODE } from "../lib/demo";
import { getDeviceId } from "../lib/device";
import { DEMO_ACCOUNTS } from "./demoAccounts";

interface QuickLoginChipsProps {
  onSelect: (request: LoginRequest) => void;
  disabled?: boolean;
  /** Classes for one chip: its height and text size. Field roles need the larger touch target. */
  chipClassName?: string;
  /** One scrolling row instead of wrapping, where height is short (the phone-sized field logins). */
  singleRow?: boolean;
}

/** One chip per seeded account, so a judge can sign in as any role in one tap. Demo deployments only. */
export function QuickLoginChips({
  onSelect,
  disabled,
  chipClassName = "min-h-8 px-3 text-xs",
  singleRow = false,
}: QuickLoginChipsProps) {
  const { t } = useTranslation("shared/common");
  if (!DEMO_MODE) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-muted">{t("demo.label")}</p>
      <div className={`flex gap-2 ${singleRow ? "overflow-x-auto" : "flex-wrap"}`}>
        {DEMO_ACCOUNTS.map((account) => {
          const name = `${t(`roles.${account.role}`)} · ${account.login}`;
          return (
            <button
              key={account.role}
              type="button"
              disabled={disabled}
              aria-label={t("demo.signInAs", { account: name })}
              onClick={() => onSelect(account.request(getDeviceId()))}
              className={`shrink-0 rounded-full border border-border bg-surface-2 font-semibold whitespace-nowrap text-text disabled:opacity-60 ${chipClassName}`}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
