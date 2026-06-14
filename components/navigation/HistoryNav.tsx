"use client";

import { useSessionHistory } from "./SessionHistoryContext";

export default function HistoryNav() {
  const { canGoBack, canGoForward, goBack, goForward } = useSessionHistory();

  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={goBack}
        disabled={!canGoBack}
        title="Go back"
        className="px-1.5 py-1 rounded text-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ color: "var(--nav-fg)" }}
        aria-label="Go back"
      >
        ‹
      </button>
      <button
        onClick={goForward}
        disabled={!canGoForward}
        title="Go forward"
        className="px-1.5 py-1 rounded text-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ color: "var(--nav-fg)" }}
        aria-label="Go forward"
      >
        ›
      </button>
    </div>
  );
}
