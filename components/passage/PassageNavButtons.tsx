"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import type { Passage } from "@/lib/db/schema";
import DefinePassageDialog from "./DefinePassageDialog";
import { useTranslation } from "@/lib/i18n/LocaleContext";
import { OSIS_REF_BOOK_NAMES, CONTIGUOUS_BOOK_PAIRS, CONTIGUOUS_BOOK_PREV } from "@/lib/utils/osis";

interface Props {
  book: string;         // OSIS book code
  textSource: string;
  bookName: string;
  currentChapter: number;
  chapterCount: number;
  /** If provided, the matching passage in the dropdown is highlighted as active. */
  currentPassageId?: number;
}

export default function PassageNavButtons({
  book,
  textSource,
  bookName,
  currentChapter,
  chapterCount,
  currentPassageId,
}: Props) {
  const { t } = useTranslation();
  const [dropdownOpen, setDropdownOpen]   = useState(false);
  const [dialogOpen,   setDialogOpen]     = useState(false);
  const [passages,     setPassages]       = useState<Passage[]>([]);
  const [loading,      setLoading]        = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // The sibling book in the contiguous pair (whichever direction)
  const siblingBook = CONTIGUOUS_BOOK_PAIRS[book] ?? CONTIGUOUS_BOOK_PREV[book] ?? null;

  // Fetch passages whenever the dropdown is opened
  useEffect(() => {
    if (!dropdownOpen) return;
    setLoading(true);
    const url = siblingBook
      ? `/api/passages?book=${encodeURIComponent(book)}&book2=${encodeURIComponent(siblingBook)}&source=${textSource}`
      : `/api/passages?book=${encodeURIComponent(book)}&source=${textSource}`;
    fetch(url)
      .then((r) => r.json())
      .then((data: { passages?: Passage[] }) => setPassages(data.passages ?? []))
      .catch(() => setPassages([]))
      .finally(() => setLoading(false));
  }, [dropdownOpen, book, siblingBook, textSource]);

  // Close dropdown on outside click
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
      setDropdownOpen(false);
    }
  }, []);

  useEffect(() => {
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen, handleClickOutside]);

  async function handleDelete(id: number) {
    await fetch(`/api/passages/${id}`, { method: "DELETE" });
    setPassages((prev) => prev.filter((p) => p.id !== id));
    setConfirmDeleteId(null);
  }

  function formatRef(p: Passage) {
    const startPrefix = p.book !== book ? `${OSIS_REF_BOOK_NAMES[p.book] ?? p.book} ` : "";
    if (p.endBook && p.endBook !== p.book) {
      const endName = OSIS_REF_BOOK_NAMES[p.endBook] ?? p.endBook;
      return `${startPrefix}${p.startChapter}:${p.startVerse} – ${endName} ${p.endChapter}:${p.endVerse}`;
    }
    const ref = p.startChapter === p.endChapter
      ? `${p.startChapter}:${p.startVerse}–${p.endVerse}`
      : `${p.startChapter}:${p.startVerse} – ${p.endChapter}:${p.endVerse}`;
    return `${startPrefix}${ref}`;
  }

  return (
    <>
      {/* 📖 Passages button + dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setDropdownOpen((v) => !v)}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors"
          style={{ color: "var(--nav-fg)" }}
          title={t("passages.titleButton")}
        >
          <span>📖</span>
          <span>{t("passages.button")}</span>
          <span className="text-[10px] opacity-60">{dropdownOpen ? "▲" : "▼"}</span>
        </button>

        {dropdownOpen && (
          <div
            className="absolute right-0 top-full mt-1 w-72 rounded-lg shadow-xl border z-50 overflow-hidden"
            style={{
              backgroundColor: "var(--background)",
              borderColor: "var(--border)",
            }}
          >
            {/* Passage list */}
            <div className="max-h-56 overflow-y-auto">
              {loading ? (
                <p className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("passages.loading")}
                </p>
              ) : passages.length === 0 ? (
                <p className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("passages.noPassages")}
                </p>
              ) : (
                passages.map((p) => {
                  const isActive = p.id === currentPassageId;
                  const confirmingDelete = confirmDeleteId === p.id;
                  return (
                    <div
                      key={p.id}
                      className="flex items-center border-b last:border-0"
                      style={{
                        borderColor: "var(--border)",
                        backgroundColor: isActive ? "rgba(200,155,60,0.10)" : undefined,
                      }}
                    >
                      <Link
                        href={`/${encodeURIComponent(p.book)}/${textSource}/passage/${p.id}`}
                        onClick={() => setDropdownOpen(false)}
                        className="flex items-baseline gap-2 flex-1 px-4 py-2.5 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors min-w-0"
                      >
                        {isActive && (
                          <span className="text-[9px] shrink-0" style={{ color: "var(--accent)" }}>▶</span>
                        )}
                        <span className="flex-1 text-sm font-mono truncate" style={{ color: isActive ? "var(--accent)" : "var(--foreground)" }}>
                          {formatRef(p)}
                        </span>
                      </Link>
                      <div className="shrink-0 flex items-center gap-1 pr-2">
                        {confirmingDelete ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleDelete(p.id)}
                              className="text-[11px] px-1.5 py-0.5 rounded bg-red-600 text-white hover:bg-red-700 transition-colors"
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-[11px] px-1.5 py-0.5 rounded hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
                              style={{ color: "var(--text-muted)" }}
                            >
                              No
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(p.id)}
                            className="text-[13px] opacity-30 hover:opacity-100 px-1 rounded hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
                            style={{ color: "var(--text-muted)" }}
                            title="Delete passage"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* "Define New Passage" button */}
            <div
              className="border-t px-4 py-2.5"
              style={{ borderColor: "var(--border)" }}
            >
              <button
                type="button"
                onClick={() => { setDropdownOpen(false); setDialogOpen(true); }}
                className="w-full text-xs text-left font-medium transition-colors hover:opacity-80"
                style={{ color: "var(--accent)" }}
              >
                {t("passages.defineNew")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Define Passage Dialog (portal-like rendering via conditional) */}
      {dialogOpen && (
        <DefinePassageDialog
          book={book}
          textSource={textSource}
          bookName={bookName}
          currentChapter={currentChapter}
          chapterCount={chapterCount}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  );
}
