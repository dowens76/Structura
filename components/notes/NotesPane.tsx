"use client";

import { useEffect, useRef, useState } from "react";
import NoteEditor from "./NoteEditor";
import { OSIS_BOOK_NAMES } from "@/lib/utils/osis";

interface NoteSection {
  key: string;
  noteType: "verse" | "chapter" | "passage";
  label: string;        // display heading, e.g. "Genesis 1:1" or "Chapter notes:"
  book?: string;
  chapter?: number;
  verse?: number;       // present for verse sections (for scroll targeting)
}

interface NotesPaneProps {
  book: string;         // OSIS code, e.g. "Gen"
  chapter: number;
  verses: number[];     // ordered verse numbers present in the chapter
  /** verse number to scroll to (driven by clicking a verse label in the text) */
  scrollToVerse: number | null;
  onScrollHandled: () => void;
  onClose: () => void;
}

export default function NotesPane({
  book,
  chapter,
  verses,
  scrollToVerse,
  onScrollHandled,
  onClose,
}: NotesPaneProps) {
  const bookName = OSIS_BOOK_NAMES[book] ?? book;
  const paneRef = useRef<HTMLDivElement>(null);

  // Build ordered list of sections: chapter header first, then one per verse
  const sections: NoteSection[] = [
    {
      key: `chapter:${book}.${chapter}`,
      noteType: "chapter",
      label: `Chapter notes: ${bookName} ${chapter}`,
      book,
      chapter,
    },
    ...verses.map((v) => ({
      key: `verse:${book}.${chapter}.${v}`,
      noteType: "verse" as const,
      label: `${bookName} ${chapter}:${v}`,
      book,
      chapter,
      verse: v,
    })),
  ];

  // Fetch existing note content for all keys at once
  const [noteContents, setNoteContents] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const keys = sections.map((s) => s.key).join(",");
    fetch(`/api/notes?keys=${encodeURIComponent(keys)}`)
      .then((r) => r.json())
      .then((data: Record<string, { content: string }>) => {
        const map: Record<string, string> = {};
        for (const key of sections.map((s) => s.key)) {
          map[key] = data[key]?.content ?? "{}";
        }
        setNoteContents(map);
        setLoaded(true);
      })
      .catch(() => {
        const map: Record<string, string> = {};
        for (const s of sections) map[s.key] = "{}";
        setNoteContents(map);
        setLoaded(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, chapter]);

  // Scroll to a verse section when triggered
  useEffect(() => {
    if (scrollToVerse == null || !loaded || !paneRef.current) return;
    const key = `verse:${book}.${chapter}.${scrollToVerse}`;
    const el = paneRef.current.querySelector(`[data-note-key="${CSS.escape(key)}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    onScrollHandled();
  }, [scrollToVerse, loaded, book, chapter, onScrollHandled]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
        <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
          Notes
        </h2>
        <button
          onClick={onClose}
          className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 text-lg leading-none"
          aria-label="Close notes pane"
        >
          ×
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto" ref={paneRef}>
        {!loaded ? (
          <div className="px-4 py-6 text-xs text-stone-400 dark:text-stone-500">Loading…</div>
        ) : (
          sections.map((section) => (
            <div
              key={section.key}
              data-note-key={section.key}
              className="border-b border-stone-100 dark:border-stone-800 last:border-b-0"
            >
              {/* Read-only heading */}
              <div
                className="px-4 pt-3 pb-1 text-xs font-semibold select-none"
                style={{
                  color: section.noteType === "chapter"
                    ? "var(--accent)"
                    : "var(--text-muted)",
                }}
              >
                {section.label}
              </div>

              {/* Rich-text editor */}
              <div className="px-2 pb-3">
                <NoteEditor
                  key={section.key}
                  noteKey={section.key}
                  noteType={section.noteType}
                  initialContent={noteContents[section.key] ?? "{}"}
                  book={section.book}
                  chapter={section.chapter}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
