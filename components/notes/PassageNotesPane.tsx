"use client";

import { useEffect, useRef, useState } from "react";
import NoteEditor from "./NoteEditor";
import { OSIS_BOOK_NAMES } from "@/lib/utils/osis";

interface VerseRef { ch: number; v: number; }

interface NoteSection {
  key: string;
  noteType: "verse" | "chapter" | "passage";
  label: string;
  book?: string;
  chapter?: number;
  /** Set for verse sections so we can scroll to them */
  verseRef?: VerseRef;
  /** Used to group section visually */
  isChapterHeading?: boolean;
}

interface PassageNotesPaneProps {
  passageId: number;
  passageLabel: string;       // e.g. "The Creation Account"
  book: string;               // OSIS code
  bookName: string;
  /** Ordered list of { ch, v } for all verses in the passage */
  orderedVerses: VerseRef[];
  isMultiChapter: boolean;
  /** Verse to scroll to when a verse number is clicked in the text */
  scrollToVerse: VerseRef | null;
  onScrollHandled: () => void;
  onClose: () => void;
}

export default function PassageNotesPane({
  passageId,
  passageLabel,
  book,
  bookName,
  orderedVerses,
  isMultiChapter,
  scrollToVerse,
  onScrollHandled,
  onClose,
}: PassageNotesPaneProps) {
  const paneRef = useRef<HTMLDivElement>(null);

  // Build ordered sections: passage note → [chapter note →] verse notes
  const sections: NoteSection[] = [];

  // 1. Passage-level note
  sections.push({
    key: `passage:${passageId}`,
    noteType: "passage",
    label: `Passage notes: ${passageLabel}`,
  });

  // 2. Per-chapter and per-verse notes
  const chaptersSeen = new Set<number>();
  for (const { ch, v } of orderedVerses) {
    if (isMultiChapter && !chaptersSeen.has(ch)) {
      chaptersSeen.add(ch);
      sections.push({
        key: `chapter:${book}.${ch}`,
        noteType: "chapter",
        label: `Chapter notes: ${bookName} ${ch}`,
        book,
        chapter: ch,
        isChapterHeading: true,
      });
    }
    sections.push({
      key: `verse:${book}.${ch}.${v}`,
      noteType: "verse",
      label: `${bookName} ${ch}:${v}`,
      book,
      chapter: ch,
      verseRef: { ch, v },
    });
  }

  // Fetch existing content for all keys
  const [noteContents, setNoteContents] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const keys = sections.map((s) => s.key).join(",");
    fetch(`/api/notes?keys=${encodeURIComponent(keys)}`)
      .then((r) => r.json())
      .then((data: Record<string, { content: string }>) => {
        const map: Record<string, string> = {};
        for (const s of sections) {
          map[s.key] = data[s.key]?.content ?? "{}";
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
  }, [passageId, book]);

  // Scroll to a verse section when triggered by clicking a verse label
  useEffect(() => {
    if (!scrollToVerse || !loaded || !paneRef.current) return;
    const key = `verse:${book}.${scrollToVerse.ch}.${scrollToVerse.v}`;
    const el = paneRef.current.querySelector(`[data-note-key="${CSS.escape(key)}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    onScrollHandled();
  }, [scrollToVerse, loaded, book, onScrollHandled]);

  return (
    <div
      className="flex flex-col h-full"
    >
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
                  color: section.noteType !== "verse"
                    ? "var(--accent)"
                    : "var(--text-muted)",
                }}
              >
                {section.label}
              </div>

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
