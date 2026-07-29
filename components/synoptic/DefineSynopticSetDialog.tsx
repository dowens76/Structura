"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OSIS_BOOKS_OT, OSIS_BOOKS_NT, OSIS_BOOK_NAMES } from "@/lib/utils/osis";
import type { SynopticSetWithColumns } from "@/lib/db/queries";

interface ColumnDraft {
  book: string;
  textSource: string;
  columnLabel: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
  chapterCount: number;
}

function sourcesForBook(book: string): string[] {
  return OSIS_BOOKS_NT.includes(book) ? ["SBLGNT"] : ["OSHB", "STEPBIBLE_LXX"];
}

function newColumn(book = "Matt"): ColumnDraft {
  return {
    book,
    textSource: sourcesForBook(book)[0],
    columnLabel: OSIS_BOOK_NAMES[book] ?? book,
    startChapter: 1,
    startVerse: 1,
    endChapter: 1,
    endVerse: 1,
    chapterCount: 1,
  };
}

interface Props {
  /** Present when editing an existing set's scope; omit to create a new set. */
  existingSet?: SynopticSetWithColumns;
  onClose: () => void;
  /** Called after a successful create/save with the resulting set. */
  onSaved: (set: SynopticSetWithColumns) => void;
}

export default function DefineSynopticSetDialog({ existingSet, onClose, onSaved }: Props) {
  const router = useRouter();
  const isEdit = !!existingSet;

  const [title, setTitle] = useState(existingSet?.title ?? "");
  const [corpus, setCorpus] = useState(existingSet?.corpus ?? "custom");
  const [columns, setColumns] = useState<ColumnDraft[]>(() => {
    if (existingSet && existingSet.columns.length > 0) {
      return existingSet.columns.map((c) => ({
        book: c.book,
        textSource: c.textSource,
        columnLabel: c.columnLabel ?? c.label,
        startChapter: c.startChapter,
        startVerse: c.startVerse,
        endChapter: c.endChapter,
        endVerse: c.endVerse,
        chapterCount: 1, // fetched below
      }));
    }
    return [newColumn("Matt"), newColumn("Mark"), newColumn("Luke")];
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch each column's chapter count once on mount / whenever a book changes.
  useEffect(() => {
    let cancelled = false;
    columns.forEach((col, i) => {
      fetch(`/api/book-info?book=${encodeURIComponent(col.book)}&source=${col.textSource}`)
        .then((r) => r.json())
        .then((d: { chapterCount?: number }) => {
          if (cancelled) return;
          setColumns((prev) => {
            const next = [...prev];
            if (next[i] && next[i].book === col.book && next[i].textSource === col.textSource) {
              next[i] = { ...next[i], chapterCount: d.chapterCount ?? 1 };
            }
            return next;
          });
        })
        .catch(() => { /* keep chapterCount default of 1 */ });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns.map((c) => `${c.book}:${c.textSource}`).join(",")]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function updateColumn(i: number, updates: Partial<ColumnDraft>) {
    setColumns((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...updates } : c)));
  }

  function handleBookChange(i: number, book: string) {
    const sources = sourcesForBook(book);
    updateColumn(i, {
      book,
      textSource: sources[0],
      columnLabel: OSIS_BOOK_NAMES[book] ?? book,
      startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1,
      chapterCount: 1,
    });
  }

  function addColumn() {
    setColumns((prev) => [...prev, newColumn("Matt")]);
  }

  function removeColumn(i: number) {
    setColumns((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (columns.length === 0) {
      setError("At least one column is required.");
      return;
    }
    for (const col of columns) {
      if (col.startChapter > col.endChapter || (col.startChapter === col.endChapter && col.startVerse > col.endVerse)) {
        setError(`${col.columnLabel || col.book}: start must not be after end.`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const body = {
        title: title.trim(),
        corpus,
        columns: columns.map((c) => ({
          book: c.book,
          textSource: c.textSource,
          columnLabel: c.columnLabel.trim() || (OSIS_BOOK_NAMES[c.book] ?? c.book),
          startChapter: c.startChapter,
          startVerse: c.startVerse,
          endChapter: c.endChapter,
          endVerse: c.endVerse,
        })),
      };

      const url = isEdit ? `/api/synoptic-sets/${existingSet!.id}` : "/api/synoptic-sets";
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Failed to save — please try again.");
        return;
      }

      const { set } = await res.json();
      onSaved(set);
      onClose();
      if (!isEdit) router.push(`/synoptic/${set.id}`);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const numInput = "w-14 px-1.5 py-1 rounded border text-sm text-center";
  const inputStyle: React.CSSProperties = {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    borderColor: "var(--border)",
  };
  const selectStyle = inputStyle;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-2xl rounded-lg shadow-xl border flex flex-col"
        style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
            {isEdit ? "Edit Synoptic Set" : "New Synoptic Set"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xl leading-none opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: "var(--foreground)" }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. The Feeding of the 5000"
                className="w-full px-2 py-1 rounded border text-sm"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>Corpus</label>
              <select value={corpus} onChange={(e) => setCorpus(e.target.value)} className="px-2 py-1 rounded border text-sm" style={selectStyle}>
                <option value="gospels">Gospels</option>
                <option value="historical">Historical</option>
                <option value="psalms">Psalms</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Columns
            </div>
            {columns.map((col, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center gap-2 p-2 rounded border"
                style={{ borderColor: "var(--border)" }}
              >
                <select
                  value={col.book}
                  onChange={(e) => handleBookChange(i, e.target.value)}
                  className="px-1.5 py-1 rounded border text-sm"
                  style={selectStyle}
                >
                  <optgroup label="Old Testament">
                    {OSIS_BOOKS_OT.map((b) => (
                      <option key={b} value={b}>{OSIS_BOOK_NAMES[b] ?? b}</option>
                    ))}
                  </optgroup>
                  <optgroup label="New Testament">
                    {OSIS_BOOKS_NT.map((b) => (
                      <option key={b} value={b}>{OSIS_BOOK_NAMES[b] ?? b}</option>
                    ))}
                  </optgroup>
                </select>

                {sourcesForBook(col.book).length > 1 && (
                  <select
                    value={col.textSource}
                    onChange={(e) => updateColumn(i, { textSource: e.target.value })}
                    className="px-1.5 py-1 rounded border text-xs"
                    style={selectStyle}
                  >
                    {sourcesForBook(col.book).map((s) => (
                      <option key={s} value={s}>{s === "STEPBIBLE_LXX" ? "LXX" : s}</option>
                    ))}
                  </select>
                )}

                <input
                  type="text"
                  value={col.columnLabel}
                  onChange={(e) => updateColumn(i, { columnLabel: e.target.value })}
                  placeholder="Column label"
                  className="w-28 px-1.5 py-1 rounded border text-sm"
                  style={inputStyle}
                />

                <div className="flex items-center gap-1">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>ch.</span>
                  <input
                    type="number" min={1} max={col.chapterCount}
                    value={col.startChapter}
                    onChange={(e) => updateColumn(i, { startChapter: Math.max(1, Math.min(col.chapterCount, Number(e.target.value))) })}
                    className={numInput} style={inputStyle}
                  />
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>v.</span>
                  <input
                    type="number" min={1}
                    value={col.startVerse}
                    onChange={(e) => updateColumn(i, { startVerse: Math.max(1, Number(e.target.value)) })}
                    className={numInput} style={inputStyle}
                  />
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>–</span>
                  <input
                    type="number" min={col.startChapter} max={col.chapterCount}
                    value={col.endChapter}
                    onChange={(e) => updateColumn(i, { endChapter: Math.max(col.startChapter, Math.min(col.chapterCount, Number(e.target.value))) })}
                    className={numInput} style={inputStyle}
                  />
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>:</span>
                  <input
                    type="number" min={1}
                    value={col.endVerse}
                    onChange={(e) => updateColumn(i, { endVerse: Math.max(1, Number(e.target.value)) })}
                    className={numInput} style={inputStyle}
                  />
                </div>

                {columns.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeColumn(i)}
                    className="ml-auto text-red-500 hover:text-red-700 text-sm leading-none"
                    title="Remove column"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addColumn}
              className="text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
            >
              + Add column
            </button>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded text-sm transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: "var(--accent)", color: "#fff" }}
            >
              {isSubmitting ? "Saving…" : isEdit ? "Save Changes" : "Create Synoptic Set"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
