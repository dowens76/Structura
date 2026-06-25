"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { OSIS_BOOK_ORDER } from "@/lib/utils/osis";

export interface BookmarkView {
  translations: string[];
  displayMode?: string;
  interlinearSubMode?: string;
}

export interface BookmarkEntry {
  id: string;
  label: string;
  href: string;
  /** Parsed view state stored in the DB's `translations` JSON column. */
  view: BookmarkView;
  createdAt: number;
}

type SortOrder = "time" | "canonical";

const TRANSLATIONS_KEY = "structura:activeTranslations";
const SORT_KEY = "structura:bookmarkSort";

/** Custom event dispatched when a bookmark navigation should apply a saved view. */
export const APPLY_BOOKMARK_VIEW_EVENT = "structura:applyBookmarkView";

function parseCanonicalKey(href: string): number {
  const parts = href.split("/").filter(Boolean);
  const book = decodeURIComponent(parts[0] ?? "");
  const chapterOrPassage = parts[2] ?? "";
  const bookOrder = OSIS_BOOK_ORDER[book] ?? 999;
  const isPassage = chapterOrPassage === "passage";
  const chapter = isPassage ? 9999 : parseInt(parts[2] ?? "0", 10) || 0;
  return bookOrder * 100000 + chapter;
}

/** Parse the `translations` JSON column — supports legacy string[] and new BookmarkView object. */
function parseViewColumn(raw: string): BookmarkView {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { translations: parsed };
    return parsed as BookmarkView;
  } catch {
    return { translations: [] };
  }
}

async function fetchBookmarks(): Promise<BookmarkEntry[]> {
  try {
    const res = await fetch("/api/bookmarks");
    if (!res.ok) return [];
    const rows = await res.json() as { id: string; label: string; href: string; translations: string; createdAt: number }[];
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      href: r.href,
      view: parseViewColumn(r.translations),
      createdAt: r.createdAt,
    }));
  } catch {
    return [];
  }
}

function readCurrentView(): BookmarkView {
  try {
    const translations = (() => {
      const raw = localStorage.getItem(TRANSLATIONS_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    })();
    const displayMode = localStorage.getItem("structura:displayMode")?.replace(/^"|"$/g, "") ?? undefined;
    const interlinearSubMode = localStorage.getItem("structura:interlinearSubMode")?.replace(/^"|"$/g, "") ?? undefined;
    return { translations, displayMode, interlinearSubMode };
  } catch {
    return { translations: [] };
  }
}

interface BookmarkButtonProps {
  href?: string;
  label?: string;
  buttonLabel?: string;
}

export default function BookmarkButton({ href, label, buttonLabel }: BookmarkButtonProps) {
  const [open, setOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>("time");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const refreshBookmarks = useCallback(async () => {
    const bm = await fetchBookmarks();
    setBookmarks(bm);
    setIsBookmarked(href ? bm.some((b) => b.href === href) : false);
  }, [href]);

  useEffect(() => {
    refreshBookmarks();
    try {
      const saved = localStorage.getItem(SORT_KEY);
      if (saved === "canonical" || saved === "time") setSortOrder(saved);
    } catch {}
  }, [refreshBookmarks]);

  function toggleSortOrder() {
    const next: SortOrder = sortOrder === "time" ? "canonical" : "time";
    setSortOrder(next);
    try { localStorage.setItem(SORT_KEY, next); } catch {}
  }

  const sortedBookmarks = [...bookmarks].sort((a, b) => {
    if (sortOrder === "canonical") return parseCanonicalKey(a.href) - parseCanonicalKey(b.href);
    return b.createdAt - a.createdAt;
  });

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function toggleOpen() {
    if (!open) refreshBookmarks();
    setOpen((v) => !v);
  }

  async function addBookmark() {
    const view = readCurrentView();
    const entry: BookmarkEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      label: label ?? "",
      href: href ?? "",
      view,
      createdAt: Date.now(),
    };
    // The DB column is still named `translations`; we store the full view object there as JSON
    await fetch("/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...entry, translations: view }),
    });
    setBookmarks((prev) => [entry, ...prev.filter((b) => b.href !== href)]);
    setIsBookmarked(true);
  }

  async function removeBookmark() {
    const toRemove = bookmarks.filter((b) => b.href === href);
    await Promise.all(toRemove.map((b) =>
      fetch(`/api/bookmarks?id=${encodeURIComponent(b.id)}`, { method: "DELETE" })
    ));
    setBookmarks((prev) => prev.filter((b) => b.href !== href));
    setIsBookmarked(false);
  }

  async function deleteBookmark(id: string) {
    await fetch(`/api/bookmarks?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const updated = bookmarks.filter((b) => b.id !== id);
    setBookmarks(updated);
    if (updated.every((b) => b.href !== href)) setIsBookmarked(false);
  }

  function navigateToBookmark(bm: BookmarkEntry) {
    setOpen(false);
    const { translations, displayMode, interlinearSubMode } = bm.view;
    // Write to localStorage so a fresh mount picks up the right state
    try {
      if (translations.length > 0)
        localStorage.setItem(TRANSLATIONS_KEY, JSON.stringify(translations));
      if (displayMode)
        localStorage.setItem("structura:displayMode", JSON.stringify(displayMode));
      if (interlinearSubMode)
        localStorage.setItem("structura:interlinearSubMode", JSON.stringify(interlinearSubMode));
    } catch {}
    // Dispatch event so ChapterDisplay can apply the view immediately (it may not remount)
    window.dispatchEvent(new CustomEvent(APPLY_BOOKMARK_VIEW_EVENT, { detail: bm.view }));
    router.push(bm.href);
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={toggleOpen}
        title={isBookmarked ? "Bookmarks (this page is bookmarked)" : "Bookmarks"}
        className="px-1.5 py-1 rounded text-sm transition-colors"
        style={{ color: isBookmarked ? "var(--accent)" : "var(--nav-fg)" }}
        aria-label="Bookmarks"
      >
        {buttonLabel ?? (isBookmarked ? "★" : "☆")}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 rounded-lg border shadow-lg py-1 min-w-[260px] max-w-[340px]"
          style={{ backgroundColor: "var(--nav-bg)", borderColor: "var(--nav-border)" }}
        >
          {href && (
            <div className="px-3 py-2 border-b" style={{ borderColor: "var(--nav-border)" }}>
              {isBookmarked ? (
                <button
                  onClick={removeBookmark}
                  className="w-full text-left text-xs flex items-center gap-2 transition-colors"
                  style={{ color: "var(--nav-fg)" }}
                >
                  <span style={{ color: "var(--accent)" }}>★</span>
                  <span>Remove bookmark for this page</span>
                </button>
              ) : (
                <button
                  onClick={addBookmark}
                  className="w-full text-left text-xs flex items-center gap-2 transition-colors"
                  style={{ color: "var(--nav-fg)" }}
                >
                  <span>☆</span>
                  <span>Bookmark this page</span>
                </button>
              )}
            </div>
          )}

          {bookmarks.length === 0 ? (
            <p className="px-3 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
              No bookmarks yet.
            </p>
          ) : (
            <>
              <div
                className="flex items-center justify-end gap-1 px-3 py-1.5 border-b"
                style={{ borderColor: "var(--nav-border)" }}
              >
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Sort:</span>
                <button
                  onClick={toggleSortOrder}
                  className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
                  style={{ color: sortOrder === "time" ? "var(--accent)" : "var(--text-muted)", fontWeight: sortOrder === "time" ? 600 : 400 }}
                  title="Sort by time added (newest first)"
                >
                  Recent
                </button>
                <span style={{ color: "var(--nav-border)" }}>·</span>
                <button
                  onClick={toggleSortOrder}
                  className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
                  style={{ color: sortOrder === "canonical" ? "var(--accent)" : "var(--text-muted)", fontWeight: sortOrder === "canonical" ? 600 : 400 }}
                  title="Sort by canonical book order"
                >
                  Canonical
                </button>
              </div>
              <ul className="max-h-72 overflow-y-auto">
                {sortedBookmarks.map((bm) => (
                  <li key={bm.id} className="flex items-center gap-1 px-2 py-1 group">
                    <button
                      onClick={() => navigateToBookmark(bm)}
                      className="flex-1 text-left px-1 py-1 rounded text-xs truncate transition-colors"
                      style={{ color: bm.href === href ? "var(--accent)" : "var(--nav-fg)" }}
                      title={bm.label + (bm.view.translations.length ? ` · ${bm.view.translations.join(", ")}` : "")}
                    >
                      <span className="font-medium">{bm.label}</span>
                      {bm.view.translations.length > 0 && (
                        <span className="ml-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
                          {bm.view.translations.join(", ")}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => deleteBookmark(bm.id)}
                      className="opacity-0 group-hover:opacity-100 px-1 py-0.5 rounded text-xs transition-opacity"
                      style={{ color: "var(--text-muted)" }}
                      title="Remove bookmark"
                      aria-label="Remove bookmark"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
