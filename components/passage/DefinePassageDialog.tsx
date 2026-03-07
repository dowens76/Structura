"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

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

  const [label,        setLabel]        = useState("");
  const [startChapter, setStartChapter] = useState(currentChapter);
  const [startVerse,   setStartVerse]   = useState(1);
  const [endChapter,   setEndChapter]   = useState(currentChapter);
  const [endVerse,     setEndVerse]     = useState(10);
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

  // Keep end ≥ start
  function clampEnd(sc: number, sv: number, ec: number, ev: number) {
    if (ec < sc || (ec === sc && ev < sv)) {
      setEndChapter(sc);
      setEndVerse(sv);
    }
  }

  function handleStartChapterChange(val: number) {
    const sc = Math.max(1, Math.min(chapterCount, val));
    setStartChapter(sc);
    clampEnd(sc, startVerse, endChapter, endVerse);
  }

  function handleStartVerseChange(val: number) {
    const sv = Math.max(1, val);
    setStartVerse(sv);
    clampEnd(startChapter, sv, endChapter, endVerse);
  }

  function handleEndChapterChange(val: number) {
    const ec = Math.max(1, Math.min(chapterCount, val));
    setEndChapter(ec);
    clampEnd(startChapter, startVerse, ec, endVerse);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (
      startChapter > endChapter ||
      (startChapter === endChapter && startVerse > endVerse)
    ) {
      setError("Start reference must not be after end reference.");
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
          endChapter,
          endVerse,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Failed to create passage.");
        return;
      }

      const { passage } = await res.json();
      onClose();
      router.push(`/${encodeURIComponent(book)}/${textSource}/passage/${passage.id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Preview reference string
  const preview =
    startChapter === endChapter
      ? `${bookName} ${startChapter}:${startVerse}–${endVerse}`
      : `${bookName} ${startChapter}:${startVerse} – ${endChapter}:${endVerse}`;

  // Shared number input style
  const numInput = "w-16 px-2 py-1 rounded border text-sm text-center";
  const inputStyle: React.CSSProperties = {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    borderColor: "var(--border)",
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-lg shadow-xl border"
        style={{
          backgroundColor: "var(--background)",
          borderColor: "var(--border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
            📖 Define Passage
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 py-5 space-y-5">

          {/* Label */}
          <div className="space-y-1">
            <label className="block text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Label
            </label>
            <input
              ref={firstInputRef}
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. The Creation Account"
              className="w-full px-3 py-1.5 rounded border text-sm"
              style={{ ...inputStyle }}
            />
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Optional — you can add or edit this later.
            </p>
          </div>

          {/* Range */}
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Range
            </div>

            {/* Start */}
            <div className="flex items-center gap-2">
              <span className="text-sm w-12 shrink-0" style={{ color: "var(--text-muted)" }}>From</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>Ch</span>
                <input
                  type="number"
                  min={1}
                  max={chapterCount}
                  value={startChapter}
                  onChange={(e) => handleStartChapterChange(Number(e.target.value))}
                  className={numInput}
                  style={inputStyle}
                />
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>v</span>
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

            {/* End */}
            <div className="flex items-center gap-2">
              <span className="text-sm w-12 shrink-0" style={{ color: "var(--text-muted)" }}>To</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>Ch</span>
                <input
                  type="number"
                  min={startChapter}
                  max={chapterCount}
                  value={endChapter}
                  onChange={(e) => handleEndChapterChange(Number(e.target.value))}
                  className={numInput}
                  style={inputStyle}
                />
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>v</span>
                <input
                  type="number"
                  min={startChapter === endChapter ? startVerse : 1}
                  value={endVerse}
                  onChange={(e) => setEndVerse(Math.max(startChapter === endChapter ? startVerse : 1, Number(e.target.value)))}
                  className={numInput}
                  style={inputStyle}
                />
              </div>
            </div>

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
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: "var(--accent)", color: "#fff" }}
            >
              {isSubmitting ? "Creating…" : "Create Passage"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
