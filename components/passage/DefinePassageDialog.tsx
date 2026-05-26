"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { CONTIGUOUS_BOOK_PAIRS, OSIS_REF_BOOK_NAMES } from "@/lib/utils/osis";
import { useTranslation } from "@/lib/i18n/LocaleContext";

interface Props {
  book: string;         // OSIS book code
  textSource: string;
  bookName: string;
  /** Current chapter — pre-fills the start chapter */
  currentChapter: number;
  chapterCount: number;
  onClose: () => void;
}

export default function DefinePassageDialog({
  book,
  textSource,
  bookName,
  currentChapter,
  chapterCount,
  onClose,
}: Props) {
  const router = useRouter();
  const { t } = useTranslation();

  // ── Start position ─────────────────────────────────────────────────────────
  const [startChapter, setStartChapter] = useState(currentChapter);
  const [startVerse,   setStartVerse]   = useState(1);

  // ── End position (within the start book) ───────────────────────────────────
  const [endChapter,   setEndChapter]   = useState(currentChapter);
  const [endVerse,     setEndVerse]     = useState(10);

  // ── Cross-book extension ───────────────────────────────────────────────────
  // continuationBook: the OSIS code of the book that directly follows `book`
  // (null if there is no continuation pair)
  const continuationBook = CONTIGUOUS_BOOK_PAIRS[book] ?? null;
  const continuationBookName = continuationBook ? (OSIS_REF_BOOK_NAMES[continuationBook] ?? continuationBook) : null;

  const [crossBook,         setCrossBook]         = useState(false);
  const [contChapterCount,  setContChapterCount]  = useState<number | null>(null);
  const [contEndChapter,    setContEndChapter]    = useState(1);
  const [contEndVerse,      setContEndVerse]      = useState(1);
  const [loadingContCount,  setLoadingContCount]  = useState(false);

  // ── Other state ────────────────────────────────────────────────────────────
  const [label,        setLabel]        = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const firstInputRef = useRef<HTMLInputElement>(null);

  // Focus label input on open
  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Fetch continuation book chapter count when the toggle is turned on
  useEffect(() => {
    if (!crossBook || !continuationBook) return;
    if (contChapterCount !== null) return; // already fetched
    setLoadingContCount(true);
    fetch(`/api/book-info?book=${encodeURIComponent(continuationBook)}&source=${textSource}`)
      .then((r) => r.json())
      .then((d: { chapterCount?: number }) => {
        setContChapterCount(d.chapterCount ?? 1);
      })
      .catch(() => setContChapterCount(24)) // fallback
      .finally(() => setLoadingContCount(false));
  }, [crossBook, continuationBook, contChapterCount, textSource]);

  // ── Clamping helpers ───────────────────────────────────────────────────────
  function clampEnd(sc: number, sv: number, ec: number, ev: number) {
    if (ec < sc || (ec === sc && ev < sv)) {
      setEndChapter(sc);
      setEndVerse(sv);
    }
  }

  function handleStartChapterChange(val: number) {
    const sc = Math.max(1, Math.min(chapterCount, val));
    setStartChapter(sc);
    if (!crossBook) clampEnd(sc, startVerse, endChapter, endVerse);
  }

  function handleStartVerseChange(val: number) {
    const sv = Math.max(1, val);
    setStartVerse(sv);
    if (!crossBook) clampEnd(startChapter, sv, endChapter, endVerse);
  }

  function handleEndChapterChange(val: number) {
    const ec = Math.max(startChapter, Math.min(chapterCount, val));
    setEndChapter(ec);
    clampEnd(startChapter, startVerse, ec, endVerse);
  }

  function handleContEndChapterChange(val: number) {
    const max = contChapterCount ?? 1;
    setContEndChapter(Math.max(1, Math.min(max, val)));
  }

  // ── Preview string ─────────────────────────────────────────────────────────
  const preview = (() => {
    if (!crossBook) {
      return startChapter === endChapter
        ? `${bookName} ${startChapter}:${startVerse}–${endVerse}`
        : `${bookName} ${startChapter}:${startVerse} – ${endChapter}:${endVerse}`;
    }
    return `${bookName} ${startChapter}:${startVerse} – ${continuationBookName} ${contEndChapter}:${contEndVerse}`;
  })();

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!crossBook && (
      startChapter > endChapter ||
      (startChapter === endChapter && startVerse > endVerse)
    )) {
      setError(t("definePassage.errorOrder"));
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/passages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book,
          textSource,
          label: label.trim(),
          startChapter,
          startVerse,
          endBook:    crossBook ? continuationBook : null,
          endChapter: crossBook ? contEndChapter    : endChapter,
          endVerse:   crossBook ? contEndVerse      : endVerse,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? t("definePassage.errorCreate"));
        return;
      }

      const { passage } = await res.json();
      onClose();
      router.push(`/${encodeURIComponent(book)}/${textSource}/passage/${passage.id}?newPassage=true`);
    } catch {
      setError(t("definePassage.errorNetwork"));
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Styles ─────────────────────────────────────────────────────────────────
  const numInput = "w-16 px-2 py-1 rounded border text-sm text-center";
  const inputStyle: React.CSSProperties = {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    borderColor: "var(--border)",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-lg shadow-xl border"
        style={{ backgroundColor: "var(--background)", borderColor: "var(--border)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
            {t("definePassage.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xl leading-none opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: "var(--foreground)" }}
            aria-label={t("definePassage.close")}
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 py-5 space-y-5">

          {/* Label */}
          <div className="space-y-1">
            <label className="block text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              {t("definePassage.labelHeading")}
            </label>
            <input
              ref={firstInputRef}
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("definePassage.labelPlaceholder")}
              className="w-full px-3 py-1.5 rounded border text-sm"
              style={{ ...inputStyle }}
            />
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {t("definePassage.labelHint")}
            </p>
          </div>

          {/* Range */}
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              {t("definePassage.range")}
            </div>

            {/* ── Start ── */}
            <div className="flex items-center gap-2">
              <span className="text-sm w-12 shrink-0" style={{ color: "var(--text-muted)" }}>
                {crossBook ? bookName : t("definePassage.from")}
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>{t("definePassage.chAbbr")}</span>
                <input
                  type="number"
                  min={1}
                  max={chapterCount}
                  value={startChapter}
                  onChange={(e) => handleStartChapterChange(Number(e.target.value))}
                  className={numInput}
                  style={inputStyle}
                />
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>{t("definePassage.vAbbr")}</span>
                <input
                  type="number"
                  min={1}
                  value={startVerse}
                  onChange={(e) => handleStartVerseChange(Number(e.target.value))}
                  className={numInput}
                  style={inputStyle}
                />
              </div>
            </div>

            {/* ── End — single-book ── */}
            {!crossBook && (
              <div className="flex items-center gap-2">
                <span className="text-sm w-12 shrink-0" style={{ color: "var(--text-muted)" }}>{t("definePassage.to")}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{t("definePassage.chAbbr")}</span>
                  <input
                    type="number"
                    min={startChapter}
                    max={chapterCount}
                    value={endChapter}
                    onChange={(e) => handleEndChapterChange(Number(e.target.value))}
                    className={numInput}
                    style={inputStyle}
                  />
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{t("definePassage.vAbbr")}</span>
                  <input
                    type="number"
                    min={startChapter === endChapter ? startVerse : 1}
                    value={endVerse}
                    onChange={(e) =>
                      setEndVerse(Math.max(startChapter === endChapter ? startVerse : 1, Number(e.target.value)))
                    }
                    className={numInput}
                    style={inputStyle}
                  />
                </div>
              </div>
            )}

            {/* ── End — cross-book ── */}
            {crossBook && (
              <div className="flex items-center gap-2">
                <span className="text-sm w-auto shrink-0 font-medium" style={{ color: "var(--foreground)" }}>
                  {continuationBookName}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{t("definePassage.chAbbr")}</span>
                  <input
                    type="number"
                    min={1}
                    max={contChapterCount ?? 999}
                    value={contEndChapter}
                    onChange={(e) => handleContEndChapterChange(Number(e.target.value))}
                    className={numInput}
                    style={inputStyle}
                    disabled={loadingContCount}
                  />
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{t("definePassage.vAbbr")}</span>
                  <input
                    type="number"
                    min={1}
                    value={contEndVerse}
                    onChange={(e) => setContEndVerse(Math.max(1, Number(e.target.value)))}
                    className={numInput}
                    style={inputStyle}
                    disabled={loadingContCount}
                  />
                  {loadingContCount && (
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>…</span>
                  )}
                </div>
              </div>
            )}

            {/* ── Cross-book toggle ── */}
            {continuationBook && (
              <label className="flex items-center gap-2 cursor-pointer select-none pt-0.5">
                <input
                  type="checkbox"
                  checked={crossBook}
                  onChange={(e) => {
                    setCrossBook(e.target.checked);
                    if (!e.target.checked) {
                      // Reset end to within the start book
                      setEndChapter(startChapter);
                      setEndVerse(startVerse);
                    }
                  }}
                  className="rounded"
                />
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("definePassage.extendInto", { bookName: continuationBookName ?? "" })}
                </span>
              </label>
            )}

            {/* Preview */}
            <p className="text-xs italic" style={{ color: "var(--accent)" }}>
              {preview}
            </p>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded text-sm transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              {t("definePassage.cancel")}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (crossBook && loadingContCount)}
              className="px-4 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: "var(--accent)", color: "#fff" }}
            >
              {isSubmitting ? t("definePassage.creating") : t("definePassage.createPassage")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
