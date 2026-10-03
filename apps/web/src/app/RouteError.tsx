import { useTranslation } from "react-i18next";
import { useRouteError } from "react-router";
import { ApiRequestError } from "../lib/api";
import { lastLoginRole, ROLE_PATHS } from "./roles";

/** Shown when a route cannot load, most often because the server is unreachable. Never signs the user out. */
export function RouteError() {
  const error = useRouteError();
  const { t } = useTranslation("shared/common");
  const unreachable = error instanceof ApiRequestError && error.kind === "network";
  return (
    <main
      data-theme={ROLE_PATHS[lastLoginRole()].theme}
      className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <p className="text-xl font-semibold">{t(unreachable ? "errors.unreachable" : "errors.title")}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="min-h-12 rounded-xl bg-primary px-6 text-base font-semibold text-on-primary"
      >
        {t("errors.retry")}
      </button>
    </main>
  );
}

/** The first paint while the session check runs: an empty screen in the theme this device used last. */
export function Splash() {
  return <div data-theme={ROLE_PATHS[lastLoginRole()].theme} className="min-h-dvh" />;
}
