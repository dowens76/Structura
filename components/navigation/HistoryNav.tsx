"use client";

import { useSessionHistory } from "./SessionHistoryContext";
import { useTranslation } from "@/lib/i18n/LocaleContext";

export default function HistoryNav() {
  const { canGoBack, canGoForward, goBack, goForward } = useSessionHistory();
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={goBack}
        disabled={!canGoBack}
        title={t("ui.goBack")}
        className="px-1.5 py-1 rounded text-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ color: "var(--nav-fg)" }}
        aria-label={t("ui.goBack")}
      >
        ‹
      </button>
      <button
        onClick={goForward}
        disabled={!canGoForward}
        title={t("ui.goForward")}
        className="px-1.5 py-1 rounded text-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ color: "var(--nav-fg)" }}
        aria-label={t("ui.goForward")}
      >
        ›
      </button>
    </div>
  );
}
