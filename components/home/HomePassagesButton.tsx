"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import type { Passage } from "@/lib/db/schema";
import { useTranslation } from "@/lib/i18n/LocaleContext";
import { OSIS_REF_BOOK_NAMES } from "@/lib/utils/osis";

/** Home-screen entry point for jumping to any saved (labeled) passage, across all books. */
export default function HomePassagesButton() {
  const { t } = useTranslation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [passages, setPassages] = useState<Passage[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    setLoading(true);
    fetch("/api/passages/labeled")
      .then((r) => r.json())
      .then((data: { passages?: Passage[] }) => setPassages(data.passages ?? []))
      .catch(() => setPassages([]))
      .finally(() => setLoading(false));
  }, [dropdownOpen]);

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
    const bookName = OSIS_REF_BOOK_NAMES[p.book] ?? p.book;
    if (p.endBook && p.endBook !== p.book) {
      const endName = OSIS_REF_BOOK_NAMES[p.endBook] ?? p.endBook;
      return `${bookName} ${p.startChapter}:${p.startVerse} – ${endName} ${p.endChapter}:${p.endVerse}`;
    }
    const ref = p.startChapter === p.endChapter
      ? `${p.startChapter}:${p.startVerse}–${p.endVerse}`
      : `${p.startChapter}:${p.startVerse} – ${p.endChapter}:${p.endVerse}`;
    return `${bookName} ${ref}`;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setDropdownOpen((v) => !v)}
        className="text-xs px-3 py-1.5 rounded border font-medium transition-colors flex items-center gap-1"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
        title="Jump to a saved passage"
      >
        <span>📖</span>
        <span>{t("passages.button")}</span>
        <span className="text-[10px] opacity-60">{dropdownOpen ? "▲" : "▼"}</span>
      </button>

      {dropdownOpen && (
        <div
          className="absolute left-0 top-full mt-1 w-80 rounded-lg shadow-xl border z-50 overflow-hidden"
          style={{ backgroundColor: "var(--background)", borderColor: "var(--border)" }}
        >
          <div className="max-h-72 overflow-y-auto">
            {loading ? (
              <p className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>{t("passages.loading")}</p>
            ) : passages.length === 0 ? (
              <p className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>{t("passages.noPassages")}</p>
            ) : (
              passages.map((p) => {
                const confirmingDelete = confirmDeleteId === p.id;
                return (
                  <div
                    key={p.id}
                    className="flex items-center border-b last:border-0"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <Link
                      href={`/${encodeURIComponent(p.book)}/${p.textSource}/passage/${p.id}`}
                      onClick={() => setDropdownOpen(false)}
                      className="flex flex-col gap-0.5 flex-1 px-4 py-2.5 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors min-w-0"
                    >
                      <span className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>
                        {p.label || t("passages.untitled")}
                      </span>
                      <span className="text-[11px] font-mono truncate" style={{ color: "var(--text-muted)" }}>
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
        </div>
      )}
    </div>
  );
}
