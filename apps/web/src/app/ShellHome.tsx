import { useTranslation } from "react-i18next";
import { signOut, useSession } from "../lib/session";

/**
 * A stand-in first screen for a role shell until its screens land (the role issues replace it).
 * It proves the round trip: sign in, land in the themed shell, sign out.
 */
export function ShellHome() {
  const { user } = useSession();
  const { t } = useTranslation("shared/common");
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-semibold text-muted">{t(`roles.${user.role}`)}</p>
      <p className="text-xl font-semibold">{t("session.signedInAs", { name: user.displayName })}</p>
      <button
        type="button"
        onClick={() => void signOut()}
        className="min-h-12 rounded-xl bg-primary px-6 text-base font-semibold text-on-primary"
      >
        {t("session.signOut")}
      </button>
    </main>
  );
}
