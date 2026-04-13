"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import type { Passage } from "@/lib/db/schema";
import DefinePassageDialog from "./DefinePassageDialog";
import { useTranslation } from "@/lib/i18n/LocaleContext";

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
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch passages whenever the dropdown is opened
  useEffect(() => {
    if (!dropdownOpen) return;
    setLoading(true);
    fetch(`/api/passages?book=${encodeURIComponent(book)}&source=${textSource}`)
      .then((r) => r.json())
      .then((data: { passages?: Passage[] }) => setPassages(data.passages ?? []))
      .catch(() => setPassages([]))
      .finally(() => setLoading(false));
  }, [dropdownOpen, book, textSource]);

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

  function formatRef(p: Passage) {
    return p.startChapter === p.endChapter
      ? `${p.startChapter}:${p.startVerse}–${p.endVerse}`
      : `${p.startChapter}:${p.startVerse} – ${p.endChapter}:${p.endVerse}`;
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
                  return (
                    <Link
                      key={p.id}
                      href={`/${encodeURIComponent(book)}/${textSource}/passage/${p.id}`}
                      onClick={() => setDropdownOpen(false)}
                      className="flex items-baseline gap-2 px-4 py-2.5 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors border-b last:border-0"
                      style={{
                        borderColor: "var(--border)",
                        backgroundColor: isActive ? "rgba(200,155,60,0.10)" : undefined,
                      }}
                    >
                      {isActive && (
                        <span className="text-[9px] shrink-0" style={{ color: "var(--accent)" }}>▶</span>
                      )}
                      <span className="flex-1 text-sm truncate" style={{ color: isActive ? "var(--accent)" : "var(--foreground)" }}>
                        {p.label || <em style={{ color: "var(--text-muted)" }}>{t("passages.untitled")}</em>}
                      </span>
                      <span className="text-[11px] font-mono shrink-0" style={{ color: "var(--text-muted)" }}>
                        {formatRef(p)}
                      </span>
                    </Link>
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
