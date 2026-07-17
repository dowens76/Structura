"use client";

import { useMemo, useState } from "react";
import type { Book } from "@/lib/db/schema";
import { POS_COLORS, POS_LABELS } from "@/lib/morphology/types";

type Corpus = "OSHB" | "SBLGNT" | "STEPBIBLE_LXX";

interface VocabWord {
  key: string;
  lemma: string | null;
  strongNumber: string | null;
  partOfSpeech: string | null;
  gloss: string | null;
  corpusCount: number;
}

interface VocabularyListPanelProps {
  otBooks: Book[];
  ntBooks: Book[];
  lxxBooks: Book[];
}

const CORPUS_TABS: { value: Corpus; label: string }[] = [
  { value: "OSHB", label: "Hebrew OT" },
  { value: "SBLGNT", label: "Greek NT" },
  { value: "STEPBIBLE_LXX", label: "Greek LXX" },
];

function scopeLabel(osisBooks: string[], chapterStart: number | null, chapterEnd: number | null): string {
  if (osisBooks.length === 1) {
    return chapterStart != null && chapterEnd != null
      ? `${osisBooks[0]}_${chapterStart}-${chapterEnd}`
      : osisBooks[0];
  }
  return `${osisBooks.length}books`;
}

export default function VocabularyListPanel({ otBooks, ntBooks, lxxBooks }: VocabularyListPanelProps) {
  const [corpus, setCorpus] = useState<Corpus>("OSHB");
  const [selectedBooks, setSelectedBooks] = useState<Set<string>>(new Set());
  const [chapterStart, setChapterStart] = useState<string>("");
  const [chapterEnd, setChapterEnd] = useState<string>("");
  const [minOccurrences, setMinOccurrences] = useState<string>("1");
  const [maxOccurrences, setMaxOccurrences] = useState<string>("");

  const [preview, setPreview] = useState<VocabWord[] | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const books = corpus === "OSHB" ? otBooks : corpus === "SBLGNT" ? ntBooks : lxxBooks;
  const isHebrew = corpus === "OSHB";

  const singleSelectedBook = selectedBooks.size === 1
    ? books.find((b) => b.osisCode === [...selectedBooks][0])
    : null;

  const parsedMin = parseInt(minOccurrences, 10);
  const parsedMax = maxOccurrences.trim() === "" ? null : parseInt(maxOccurrences, 10);
  const parsedStart = chapterStart.trim() === "" ? null : parseInt(chapterStart, 10);
  const parsedEnd = chapterEnd.trim() === "" ? null : parseInt(chapterEnd, 10);

  const canPreview = selectedBooks.size > 0 && Number.isFinite(parsedMin);

  function switchCorpus(c: Corpus) {
    setCorpus(c);
    setSelectedBooks(new Set());
    setChapterStart("");
    setChapterEnd("");
    setPreview(null);
    setPreviewError(null);
  }

  function toggleBook(osisCode: string) {
    setSelectedBooks((prev) => {
      const next = new Set(prev);
      if (next.has(osisCode)) next.delete(osisCode); else next.add(osisCode);
      return next;
    });
    setChapterStart("");
    setChapterEnd("");
    setPreview(null);
  }

  function selectAllBooks() {
    setSelectedBooks(new Set(books.map((b) => b.osisCode)));
    setChapterStart("");
    setChapterEnd("");
    setPreview(null);
  }

  function clearBooks() {
    setSelectedBooks(new Set());
    setChapterStart("");
    setChapterEnd("");
    setPreview(null);
  }

  const scopeParams = useMemo(() => ({
    textSource: corpus,
    osisBooks: [...selectedBooks],
    chapterStart: singleSelectedBook && parsedStart != null ? parsedStart : undefined,
    chapterEnd: singleSelectedBook && parsedEnd != null ? parsedEnd : undefined,
    minOccurrences: Number.isFinite(parsedMin) ? parsedMin : 1,
    maxOccurrences: parsedMax,
  }), [corpus, selectedBooks, singleSelectedBook, parsedStart, parsedEnd, parsedMin, parsedMax]);

  async function handlePreview() {
    if (!canPreview) return;
    setLoadingPreview(true);
    setPreviewError(null);
    try {
      const res = await fetch("/api/vocabulary/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scopeParams),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setPreviewError(data?.error ?? "Failed to load preview");
        setPreview(null);
        return;
      }
      const data: { words: VocabWord[] } = await res.json();
      setPreview(data.words);
    } catch {
      setPreviewError("Failed to load preview");
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleExport(format: "csv" | "apkg") {
    if (!preview || preview.length === 0) return;
    setExporting(true);
    try {
      const res = await fetch("/api/vocabulary/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...scopeParams, format }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = format === "csv" ? "csv" : "apkg";
      a.download = `Vocabulary-${scopeLabel([...selectedBooks], singleSelectedBook ? parsedStart : null, singleSelectedBook ? parsedEnd : null)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <button
          onClick={() => history.back()}
          className="flex items-center gap-1.5 mb-4 text-sm transition-colors hover:opacity-70"
          style={{ color: "var(--text-muted)" }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <h1 className="text-2xl font-semibold mb-1" style={{ color: "var(--foreground)" }}>
          Vocabulary List Creator
        </h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Pick a scope of books (and optionally a chapter range within one book), filter by how many
          times each word occurs across the whole corpus, then export the resulting word list as a
          CSV file or an Anki deck.
        </p>
      </div>

      {/* Corpus tabs */}
      <section>
        <h2 className="text-base font-semibold mb-2" style={{ color: "var(--foreground)" }}>
          Corpus
        </h2>
        <div className="flex gap-2">
          {CORPUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => switchCorpus(tab.value)}
              className="text-sm px-3 py-1.5 rounded border font-medium transition-colors"
              style={{
                borderColor: corpus === tab.value ? "var(--accent)" : "var(--border)",
                backgroundColor: corpus === tab.value ? "var(--accent)" : "var(--surface)",
                color: corpus === tab.value ? "white" : "var(--foreground)",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {/* Book picker */}
      <section>
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
            Books
          </h2>
          <button onClick={selectAllBooks} className="text-xs px-2 py-0.5 rounded transition-colors" style={{ color: "var(--text-muted)" }}>
            All
          </button>
          <button onClick={clearBooks} className="text-xs px-2 py-0.5 rounded transition-colors" style={{ color: "var(--text-muted)" }}>
            None
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {books.map((b) => (
            <button
              key={b.osisCode}
              onClick={() => toggleBook(b.osisCode)}
              className="text-xs px-2 py-0.5 rounded border transition-colors"
              style={{
                borderColor: selectedBooks.has(b.osisCode) ? "var(--accent)" : "var(--border)",
                backgroundColor: selectedBooks.has(b.osisCode) ? "var(--accent)" : "var(--surface-muted)",
                color: selectedBooks.has(b.osisCode) ? "white" : "var(--text-muted)",
                fontWeight: selectedBooks.has(b.osisCode) ? 600 : 400,
              }}
              title={b.name}
            >
              {b.osisCode}
            </button>
          ))}
        </div>
      </section>

      {/* Chapter range (only when exactly one book is selected) */}
      {singleSelectedBook && (
        <section>
          <h2 className="text-base font-semibold mb-2" style={{ color: "var(--foreground)" }}>
            Chapter range <span className="font-normal text-xs" style={{ color: "var(--text-muted)" }}>(optional — {singleSelectedBook.name} has {singleSelectedBook.chapterCount} chapters)</span>
          </h2>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={singleSelectedBook.chapterCount}
              value={chapterStart}
              onChange={(e) => { setChapterStart(e.target.value); setPreview(null); }}
              placeholder="1"
              className="w-20 text-sm px-2 py-1 rounded border"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
            />
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>to</span>
            <input
              type="number"
              min={1}
              max={singleSelectedBook.chapterCount}
              value={chapterEnd}
              onChange={(e) => { setChapterEnd(e.target.value); setPreview(null); }}
              placeholder={String(singleSelectedBook.chapterCount)}
              className="w-20 text-sm px-2 py-1 rounded border"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
            />
          </div>
        </section>
      )}

      {/* Occurrence filter */}
      <section>
        <h2 className="text-base font-semibold mb-2" style={{ color: "var(--foreground)" }}>
          Corpus-wide occurrence count
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>Min</span>
          <input
            type="number"
            min={0}
            value={minOccurrences}
            onChange={(e) => { setMinOccurrences(e.target.value); setPreview(null); }}
            className="w-20 text-sm px-2 py-1 rounded border"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
          />
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>Max</span>
          <input
            type="number"
            min={0}
            value={maxOccurrences}
            onChange={(e) => { setMaxOccurrences(e.target.value); setPreview(null); }}
            placeholder="unbounded"
            className="w-24 text-sm px-2 py-1 rounded border"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
          />
        </div>
      </section>

      {/* Preview button */}
      <div className="flex items-center gap-4">
        <button
          onClick={handlePreview}
          disabled={!canPreview || loadingPreview}
          className="px-4 py-2 rounded font-medium text-sm transition-colors"
          style={{
            backgroundColor: canPreview && !loadingPreview ? "var(--accent)" : "var(--surface-muted)",
            color: canPreview && !loadingPreview ? "white" : "var(--text-muted)",
            cursor: canPreview && !loadingPreview ? "pointer" : "not-allowed",
          }}
        >
          {loadingPreview ? "Loading…" : "Preview"}
        </button>
        {previewError && <span className="text-sm text-red-500">{previewError}</span>}
      </div>

      {/* Preview table */}
      {preview && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
              Preview — {preview.length} word{preview.length !== 1 ? "s" : ""}
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => handleExport("csv")}
                disabled={exporting || preview.length === 0}
                className="text-xs px-3 py-1.5 rounded border font-medium transition-colors"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
              >
                Export CSV
              </button>
              <button
                onClick={() => handleExport("apkg")}
                disabled={exporting || preview.length === 0}
                className="text-xs px-3 py-1.5 rounded border font-medium transition-colors"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
              >
                Export Anki Deck
              </button>
            </div>
          </div>

          {preview.length === 0 ? (
            <div
              className="rounded-lg border px-4 py-6 text-center text-sm"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            >
              No words match this scope and occurrence range.
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden overflow-x-auto" style={{ borderColor: "var(--border)" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ backgroundColor: "var(--surface-muted)" }}>
                    <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--text-muted)" }}>Word</th>
                    <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--text-muted)" }}>Strong&apos;s #</th>
                    <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--text-muted)" }}>POS</th>
                    <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--text-muted)" }}>Gloss</th>
                    <th className="text-right px-3 py-2 font-medium" style={{ color: "var(--text-muted)" }}>Corpus count</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {preview.map((w) => (
                    <tr key={w.key} style={{ backgroundColor: "var(--surface)" }}>
                      <td className="px-3 py-2">
                        <span
                          className={isHebrew ? "lexicon-hebrew" : "lexicon-greek"}
                          dir={isHebrew ? "rtl" : "ltr"}
                          lang={isHebrew ? "he" : "grc"}
                        >
                          {w.lemma ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs" style={{ color: "var(--text-muted)" }}>{w.strongNumber ?? "—"}</td>
                      <td className="px-3 py-2">
                        {w.partOfSpeech && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded font-medium"
                            style={{
                              backgroundColor: `${POS_COLORS[w.partOfSpeech] ?? "#6b7280"}22`,
                              color: POS_COLORS[w.partOfSpeech] ?? "#6b7280",
                            }}
                          >
                            {POS_LABELS[w.partOfSpeech] ?? w.partOfSpeech}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--foreground)" }}>{w.gloss ?? "—"}</td>
                      <td className="px-3 py-2 text-right" style={{ color: "var(--foreground)" }}>{w.corpusCount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
