import { useTranslation } from "react-i18next";
import { useDemoNotice } from "../lib/demo";
import { formatTime } from "../lib/time";

/**
 * The persistent "demo data was reset" banner every shell shows (ADR 0007). It renders nothing until the demo
 * module or the sync controller reports a reset through setDemoNotice.
 */
export function ResetBanner() {
  const notice = useDemoNotice();
  const { t } = useTranslation("shared/common");
  if (!notice) return null;
  const text =
    notice.lastResetBy && notice.lastResetAt
      ? t("resetBanner.by", { role: t(`roles.${notice.lastResetBy}`), time: formatTime(notice.lastResetAt) })
      : t("resetBanner.unknown");
  return (
    <div role="status" className="bg-warn-bg px-4 py-2 text-center text-sm font-semibold text-warn-fg">
      {text}
    </div>
  );
}
