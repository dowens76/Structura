"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import JSZip from "jszip";
import type { Book } from "@/lib/db/source-schema";
import type { Translation } from "@/lib/db/user-schema";

interface Props {
  books: Book[];
  translations: Translation[];
}

export default function UsfmExportForm({ books, translations }: Props) {
  const [selectedTranslationId, setSelectedTranslationId] = useState<number | null>(
    translations[0]?.id ?? null
  );
  const [selectedBooks, setSelectedBooks] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);

  const otBooks = useMemo(() => books.filter((b) => b.testament === "OT"), [books]);
  const ntBooks = useMemo(() => books.filter((b) => b.testament === "NT"), [books]);

  const allSelected = selectedBooks.size === books.length;
  const noneSelected = selectedBooks.size === 0;

  function toggleBook(code: string) {
    setSelectedBooks((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function selectGroup(group: Book[]) {
    setSelectedBooks((prev) => {
      const next = new Set(prev);
      const codes = group.map((b) => b.osisCode);
      const allIn = codes.every((c) => next.has(c));
      if (allIn) codes.forEach((c) => next.delete(c));
      else codes.forEach((c) => next.add(c));
      return next;
    });
  }

  function selectAll() {
    if (allSelected) setSelectedBooks(new Set());
    else setSelectedBooks(new Set(books.map((b) => b.osisCode)));
  }

  async function handleDownload() {
    if (!selectedTranslationId || selectedBooks.size === 0) return;
    setDownloading(true);
    try {
      const targets = [...selectedBooks];
      if (targets.length === 1) {
        // Single book — direct download
        const url = `/api/export/usfm?translationId=${selectedTranslationId}&book=${encodeURIComponent(targets[0])}`;
        const a = document.createElement("a");
        a.href = url;
        a.click();
      } else {
        // Multiple books — bundle into a ZIP
        const zip = new JSZip();
        const abbr = selectedTranslation?.abbreviation ?? "export";
        await Promise.all(targets.map(async (book) => {
          const url = `/api/export/usfm?translationId=${selectedTranslationId}&book=${encodeURIComponent(book)}`;
          const res = await fetch(url);
          if (!res.ok) return;
          const text = await res.text();
          const cd = res.headers.get("Content-Disposition") ?? "";
          const match = cd.match(/filename="([^"]+)"/);
          const filename = match?.[1] ?? `${abbr}_${book}.usfm`;
          zip.file(filename, text);
        }));
        const blob = await zip.generateAsync({ type: "blob" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${abbr}_${targets.length}books.zip`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } finally {
      setDownloading(false);
    }
  }

  if (translations.length === 0) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-8">
          <Link href="/" className="text-sm text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 transition-colors">← Home</Link>
          <h1 className="text-xl font-semibold">Export USFM</h1>
        </div>
        <p className="text-stone-500 dark:text-stone-400 text-sm">
          No translations found. <Link href="/import" className="underline">Import a translation</Link> first.
        </p>
      </div>
    );
  }

  const selectedTranslation = translations.find((t) => t.id === selectedTranslationId);

  function BookGrid({ group, label }: { group: Book[]; label: string }) {
    const allIn = group.every((b) => selectedBooks.has(b.osisCode));
    return (
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1.5">
          <button
            type="button"
            onClick={() => selectGroup(group)}
            className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
          >
            {label} {allIn ? "✓" : ""}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {group.map((b) => {
            const on = selectedBooks.has(b.osisCode);
            return (
              <button
                key={b.osisCode}
                type="button"
                onClick={() => toggleBook(b.osisCode)}
                className={[
                  "text-xs px-2 py-0.5 rounded border transition-colors",
                  on
                    ? "border-sky-500 bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300"
                    : "border-stone-300 dark:border-stone-600 text-stone-500 dark:text-stone-400 hover:border-stone-400 dark:hover:border-stone-500",
                ].join(" ")}
                title={b.name}
              >
                {b.osisCode}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-8">
        <Link href="/" className="text-sm text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 transition-colors">← Home</Link>
        <h1 className="text-xl font-semibold">Export USFM</h1>
      </div>

      {/* Translation selector */}
      <div className="mb-6">
        <label className="block text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-2">
          Translation
        </label>
        <div className="flex flex-wrap gap-2">
          {translations.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedTranslationId(t.id)}
              className={[
                "text-sm px-3 py-1.5 rounded border transition-colors",
                t.id === selectedTranslationId
                  ? "border-sky-500 bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 font-medium"
                  : "border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-300 hover:border-stone-400",
              ].join(" ")}
            >
              {t.abbreviation}
              {t.language ? <span className="text-[10px] ml-1 opacity-60">{t.language}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {/* Book selector */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
            Books
          </label>
          <button
            type="button"
            onClick={selectAll}
            className="text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 underline transition-colors"
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        </div>
        <BookGrid group={otBooks} label="Old Testament" />
        <BookGrid group={ntBooks} label="New Testament" />
      </div>

      {/* Summary + download */}
      <div className="border-t border-[var(--border)] pt-4 flex items-center justify-between gap-4">
        <p className="text-sm text-stone-500 dark:text-stone-400">
          {noneSelected
            ? "Select at least one book to export."
            : `${selectedBooks.size} book${selectedBooks.size !== 1 ? "s" : ""} · ${selectedTranslation?.abbreviation ?? ""}`}
        </p>
        <button
          type="button"
          onClick={handleDownload}
          disabled={noneSelected || !selectedTranslationId || downloading}
          className="px-4 py-2 rounded text-sm font-medium bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {downloading ? "Downloading…" : `Download ${selectedBooks.size > 1 ? `${selectedBooks.size} files` : "USFM"}`}
        </button>
      </div>
    </div>
  );
}
