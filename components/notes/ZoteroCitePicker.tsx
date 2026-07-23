"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ZoteroItem,
  formatCitationHtml,
  formatItemSummary,
} from "@/lib/utils/zotero";
import { useTranslation } from "@/lib/i18n/LocaleContext";
import { fetchJsonRetry } from "@/lib/utils/fetchJsonRetry";
import { openExternal } from "@/lib/utils/openExternal";

// ── Component ─────────────────────────────────────────────────────────────────

interface ZoteroCitePickerProps {
  onInsert: (html: string) => void;
  onClose: () => void;
}

export default function ZoteroCitePicker({
  onInsert,
  onClose,
}: ZoteroCitePickerProps) {
  const { t } = useTranslation();
  const panelRef  = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Credentials state — loaded from server, API key never stored in browser
  const [userId,    setUserId]    = useState("");
  const [apiKey,    setApiKey]    = useState("");   // only used in the setup form input
  const [hasApiKey, setHasApiKey] = useState(false);
  const [credsLoaded, setCredsLoaded] = useState(false);
  const [credsError, setCredsError] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState<ZoteroItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [saving,  setSaving]  = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Load credentials from server on mount ───────────────────────────────────
  // A failed check (after fetchJsonRetry's built-in retry) surfaces a distinct
  // "couldn't verify" state rather than silently falling back to the setup
  // form — that would look identical to "no credentials configured" and could
  // prompt the user to needlessly re-enter a Zotero API key that's still fine.
  const loadCredentials = useCallback(() => {
    setCredsError(false);
    fetchJsonRetry<{ userId?: string; hasApiKey?: boolean }>("/api/credentials/zotero").then((d) => {
      if (!d) {
        setCredsError(true);
        setCredsLoaded(true);
        return;
      }
      const uid = d.userId ?? "";
      const has = d.hasApiKey ?? false;
      setUserId(uid);
      setHasApiKey(has);
      setShowSetup(!uid || !has);
      setCredsLoaded(true);
    });
  }, []);

  useEffect(() => {
    loadCredentials();
  }, [loadCredentials]);

  // ── Click-outside + Escape close ─────────────────────────────────────────────
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  // ── Autofocus search input when in search mode ───────────────────────────────
  useEffect(() => {
    if (credsLoaded && !showSetup) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [showSetup, credsLoaded]);

  // ── Fetch from Zotero API ─────────────────────────────────────────────────────
  const fetchItems = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      const res  = await fetch(`/api/zotero${params.size ? `?${params}` : ""}`);
      const json = await res.json();
      if (res.status === 401) {
        setShowSetup(true);
        setResults([]);
      } else if (!res.ok) {
        setError(json.error ?? t("zotero.searchFailed"));
        setResults([]);
      } else {
        setResults(json.items ?? []);
      }
    } catch {
      setError(t("zotero.searchNetworkError"));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const [recents, setRecents] = useState<ZoteroItem[]>([]);

  // Load recents + show them when search view becomes active
  useEffect(() => {
    if (!showSetup && credsLoaded) {
      fetch("/api/zotero/recents")
        .then((r) => r.json())
        .then((d: { items?: ZoteroItem[] }) => setRecents(d.items ?? []))
        .catch(() => {});
    }
  }, [showSetup, credsLoaded]);

  // Debounced search as user types
  useEffect(() => {
    if (showSetup) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    debounceRef.current = setTimeout(() => fetchItems(query.trim()), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, showSetup]); // eslint-disable-line react-hooks/exhaustive-deps

  function recordAndInsert(item: ZoteroItem) {
    // Fire-and-forget — persist to recents list in user.db
    fetch("/api/zotero/recents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    }).catch(() => {});
    onInsert(formatCitationHtml(item));
    onClose();
  }

  // ── Save credentials to server ────────────────────────────────────────────────
  async function saveCredentials() {
    if (!userId.trim() || !apiKey.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/credentials/zotero", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userId.trim(), apiKey: apiKey.trim() }),
      });
      if (!res.ok) {
        const d = await res.json();
        setSaveError(d.error ?? t("zotero.failedToSave"));
        return;
      }
      setHasApiKey(true);
      setApiKey(""); // clear from UI — not needed anymore
      setShowSetup(false);
    } catch {
      setSaveError(t("zotero.networkError"));
    } finally {
      setSaving(false);
    }
  }

  // ── Clear credentials ─────────────────────────────────────────────────────────
  async function clearCredentials() {
    await fetch("/api/credentials/zotero", { method: "DELETE" });
    setUserId("");
    setApiKey("");
    setHasApiKey(false);
    setResults([]);
    setQuery("");
  }

  // ── Item-type badge label ─────────────────────────────────────────────────────
  function badgeLabel(itemType: string): string {
    if (itemType === "journalArticle") return "article";
    if (itemType === "bookSection")    return "chapter";
    return itemType;
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div
      ref={panelRef}
      style={{
        position:        "absolute",
        top:             "100%",
        left:            0,
        zIndex:          50,
        width:           "320px",
        backgroundColor: "var(--surface)",
        borderColor:     "var(--border)",
        color:           "var(--foreground)",
      }}
      className="border rounded-md shadow-lg mt-0.5"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
          Zotero Citation
        </span>
        <div className="flex items-center gap-0.5">
          {/* Gear — toggle setup */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setSaveError(null); setShowSetup((v) => !v); }}
            title="Zotero settings"
            className={[
              "w-5 h-5 flex items-center justify-center rounded text-xs transition-colors",
              showSetup
                ? "bg-stone-700 text-white dark:bg-stone-200 dark:text-stone-900"
                : "text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800",
            ].join(" ")}
          >
            ⚙
          </button>
          {/* Close */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClose}
            title="Close"
            className="w-5 h-5 flex items-center justify-center rounded text-lg leading-none text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
          >
            ×
          </button>
        </div>
      </div>

      {!credsLoaded ? (
        /* ── Loading state ── */
        <div className="px-3 py-4 text-xs" style={{ color: "var(--text-muted)" }}>
          {t("zotero.loading")}
        </div>
      ) : credsError ? (
        /* ── Couldn't verify credentials — distinct from "not configured" ── */
        <div className="px-3 py-4 text-xs space-y-2" style={{ color: "var(--text-muted)" }}>
          <p>Couldn&apos;t check your Zotero connection. Your saved credentials are probably fine — this looks like a temporary issue.</p>
          <button
            type="button"
            onClick={loadCredentials}
            className="text-xs px-2 py-1 rounded"
            style={{ background: "var(--accent)", color: "white" }}
          >
            Retry
          </button>
        </div>
      ) : showSetup ? (
        /* ── Setup view ── */
        <div className="p-3 flex flex-col gap-2">
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {t("zotero.setupDescPre")}{" "}
            <a
              href="https://www.zotero.org/settings/keys"
              onClick={(e) => { e.preventDefault(); openExternal("https://www.zotero.org/settings/keys"); }}
              rel="noopener noreferrer"
              className="underline"
              style={{ color: "var(--accent)" }}
            >
              zotero.org/settings/keys
            </a>
            {t("zotero.setupDescPost")}{" "}
            <span className="font-mono" style={{ color: "var(--foreground)" }}>
              {t("zotero.setupExample")}
            </span>
          </p>

          {/* Show current userId if already set */}
          {hasApiKey && userId && (
            <div
              className="text-xs px-2 py-1.5 rounded flex items-center justify-between gap-2"
              style={{ backgroundColor: "rgba(200,155,60,0.10)", color: "var(--foreground)" }}
            >
              <span>
                {t("zotero.userIdStatus", { id: userId })}
                <span className="ml-2" style={{ color: "var(--text-muted)" }}>{t("zotero.apiKeySaved")}</span>
              </span>
              <button
                type="button"
                onClick={clearCredentials}
                className="text-[10px] underline hover:opacity-80"
                style={{ color: "var(--text-muted)" }}
              >
                {t("zotero.clear")}
              </button>
            </div>
          )}

          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder={t("zotero.userIdPlaceholder")}
            className="w-full text-xs px-2 py-1.5 rounded border bg-[var(--background)] text-[var(--foreground)] placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-amber-400"
            style={{ borderColor: "var(--border)" }}
          />
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasApiKey ? t("zotero.apiKeyNewPlaceholder") : t("zotero.apiKeyPlaceholder")}
            className="w-full text-xs px-2 py-1.5 rounded border bg-[var(--background)] text-[var(--foreground)] placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-amber-400"
            style={{ borderColor: "var(--border)" }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && userId.trim() && apiKey.trim())
                saveCredentials();
            }}
          />

          {saveError && (
            <p className="text-xs text-red-500">{saveError}</p>
          )}

          <button
            type="button"
            onClick={saveCredentials}
            disabled={saving || !userId.trim() || !apiKey.trim()}
            className="w-full text-xs px-2 py-1.5 rounded font-medium bg-stone-700 text-white dark:bg-stone-200 dark:text-stone-900 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {saving ? t("zotero.saving") : t("zotero.saveAndSearch")}
          </button>
        </div>
      ) : (
        /* ── Search view ── */
        <>
          <div className="px-2 py-2 border-b" style={{ borderColor: "var(--border)" }}>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("zotero.searchPlaceholder")}
              className="w-full text-xs px-2 py-1.5 rounded border bg-[var(--background)] text-[var(--foreground)] placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-amber-400"
              style={{ borderColor: "var(--border)" }}
            />
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: "240px" }}>
            {loading && (
              <div className="px-3 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
                {t("zotero.searching")}
              </div>
            )}

            {!loading && error && (
              <div className="px-3 py-3 text-xs text-red-500 dark:text-red-400">
                {error}
              </div>
            )}

            {!loading && !error && !query.trim() && recents.length > 0 && (
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Recent
              </div>
            )}

            {!loading && !error && !query.trim() && recents.length === 0 && (
              <div className="px-3 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
                {t("zotero.typeToSearch")}
              </div>
            )}

            {!loading && !error && query.trim() && results.length === 0 && (
              <div className="px-3 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
                {t("zotero.noResults")}
              </div>
            )}

            {(!query.trim() ? recents : results).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => recordAndInsert(item)}
                className="w-full text-left px-3 py-2 border-b last:border-b-0 transition-colors hover:bg-stone-100 dark:hover:bg-stone-800"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className="text-xs flex-1 min-w-0 leading-snug"
                    style={{ color: "var(--foreground)" }}
                  >
                    {formatItemSummary(item)}
                  </span>
                  <span
                    className="text-[9px] font-medium px-1 py-0.5 rounded flex-shrink-0 bg-stone-100 dark:bg-stone-800 mt-0.5"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {badgeLabel(item.data.itemType)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
