import { useState } from "react";
import { useTranslation } from "react-i18next";
import { signOut, useSession } from "../lib/session";

/**
 * A stand-in first screen for a role shell until its screens land (the role issues replace it).
 * It proves the round trip: sign in, land in the themed shell, sign out.
 */
export function ShellHome() {
  const { user } = useSession();
  const { t } = useTranslation("shared/common");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onSignOut() {
    setPending(true);
    setFailed(false);
    try {
      // On success the shell sees the session go and leaves for the login screen.
      await signOut();
    } catch {
      // The server was not reached, so the session is still live there: stay signed in and say so.
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-semibold text-muted">{t(`roles.${user.role}`)}</p>
      <p className="text-xl font-semibold">{t("session.signedInAs", { name: user.displayName })}</p>
      <button
        type="button"
        disabled={pending}
        onClick={() => void onSignOut()}
        className="min-h-12 rounded-xl bg-primary px-6 text-base font-semibold text-on-primary disabled:opacity-60"
      >
        {t("session.signOut")}
      </button>
      {failed && (
        <p role="alert" className="rounded-xl bg-warn-bg px-4 py-2 text-sm font-semibold text-warn-fg">
          {t("session.signOutFailed")}
        </p>
      )}
    </main>
  );
}
