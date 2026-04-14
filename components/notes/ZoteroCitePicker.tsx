"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ZoteroItem,
  formatCitationHtml,
  formatItemSummary,
} from "@/lib/utils/zotero";

// ── localStorage helpers (mirrors pattern in ChapterDisplay.tsx) ──────────────

const LS_API_KEY = "structura:zoteroApiKey";
const LS_USER_ID = "structura:zoteroUserId";

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeLocal<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded — ignore */
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ZoteroCitePickerProps {
  onInsert: (html: string) => void;
  onClose: () => void;
}

export default function ZoteroCitePicker({
  onInsert,
  onClose,
}: ZoteroCitePickerProps) {
  const panelRef  = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [apiKey, setApiKey] = useState(() => readLocal<string>(LS_API_KEY, ""));
  const [userId, setUserId] = useState(() => readLocal<string>(LS_USER_ID, ""));
  const [showSetup, setShowSetup] = useState(
    () => !readLocal<string>(LS_API_KEY, "") || !readLocal<string>(LS_USER_ID, ""),
  );

  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState<ZoteroItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

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
    if (!showSetup) {
      // rAF ensures the input is visible before we focus it
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [showSetup]);

  // ── Debounced search ─────────────────────────────────────────────────────────
  const search = useCallback(
    (q: string, uid: string, key: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!q.trim() || !uid || !key) {
        setResults([]);
        setError(null);
        return;
      }
      debounceRef.current = setTimeout(async () => {
        setLoading(true);
        setError(null);
        try {
          const params = new URLSearchParams({ q, userId: uid, apiKey: key });
          const res  = await fetch(`/api/zotero?${params.toString()}`);
          const json = await res.json();
          if (!res.ok) {
            setError(json.error ?? "Search failed");
            setResults([]);
          } else {
            setResults(json.items ?? []);
          }
        } catch {
          setError("Network error");
          setResults([]);
        } finally {
          setLoading(false);
        }
      }, 300);
    },
    [],
  );

  useEffect(() => {
    search(query, userId, apiKey);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, userId, apiKey, search]);

  // ── Save credentials ─────────────────────────────────────────────────────────
  function saveCredentials() {
    writeLocal(LS_API_KEY, apiKey);
    writeLocal(LS_USER_ID, userId);
    setShowSetup(false);
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
            onClick={() => setShowSetup((v) => !v)}
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

      {showSetup ? (
        /* ── Setup view ── */
        <div className="p-3 flex flex-col gap-2">
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Both your numeric user ID and API key are at{" "}
            <a
              href="https://www.zotero.org/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: "var(--accent)" }}
            >
              zotero.org/settings/keys
            </a>
            . The user ID appears near the top of that page as{" "}
            <span className="font-mono" style={{ color: "var(--foreground)" }}>
              "Your userID for use in API calls is&nbsp;…"
            </span>
          </p>
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="User ID (numeric)"
            className="w-full text-xs px-2 py-1.5 rounded border bg-[var(--background)] text-[var(--foreground)] placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-amber-400"
            style={{ borderColor: "var(--border)" }}
          />
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="API Key"
            className="w-full text-xs px-2 py-1.5 rounded border bg-[var(--background)] text-[var(--foreground)] placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-amber-400"
            style={{ borderColor: "var(--border)" }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && apiKey.trim() && userId.trim())
                saveCredentials();
            }}
          />
          <button
            type="button"
            onClick={saveCredentials}
            disabled={!apiKey.trim() || !userId.trim()}
            className="w-full text-xs px-2 py-1.5 rounded font-medium bg-stone-700 text-white dark:bg-stone-200 dark:text-stone-900 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            Save &amp; Search
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
              placeholder="Search your Zotero library…"
              className="w-full text-xs px-2 py-1.5 rounded border bg-[var(--background)] text-[var(--foreground)] placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-amber-400"
              style={{ borderColor: "var(--border)" }}
            />
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: "240px" }}>
            {loading && (
              <div className="px-3 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
                Searching…
              </div>
            )}

            {!loading && error && (
              <div className="px-3 py-3 text-xs text-red-500 dark:text-red-400">
                {error}
              </div>
            )}

            {!loading && !error && !query.trim() && (
              <div className="px-3 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
                Type to search your library
              </div>
            )}

            {!loading && !error && query.trim() && results.length === 0 && (
              <div className="px-3 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
                No results
              </div>
            )}

            {results.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  onInsert(formatCitationHtml(item));
                  onClose();
                }}
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
