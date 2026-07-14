"use client";

import { useEffect, useRef, useState } from "react";
import NoteEditor from "./NoteEditor";
import ChapterSummarySection from "./ChapterSummarySection";
import { useTranslation } from "@/lib/i18n/LocaleContext";
import { extractTextFromTipTap } from "@/lib/utils/tiptap-text";

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
  /** Omit both when there is no passage (e.g. a plain single-chapter view) —
   *  the passage-level note section is only rendered when both are present. */
  passageId?: number;
  passageLabel?: string;      // e.g. "The Creation Account"
  book: string;               // OSIS code
  bookName: string;
  /** Ordered list of { ch, v } for all verses in the passage */
  orderedVerses: VerseRef[];
  isMultiChapter: boolean;
  /** True when the passage covers exactly one full chapter */
  isWholeChapter?: boolean;
  /** The chapter number when isWholeChapter is true */
  wholeChapterNum?: number;
  /** Verse to scroll to when a verse number is clicked in the text */
  scrollToVerse: VerseRef | null;
  onScrollHandled: () => void;
  onClose: () => void;
  synced?: boolean;
  onSyncToggle?: () => void;
}

export default function PassageNotesPane({
  passageId,
  passageLabel,
  book,
  bookName,
  orderedVerses,
  isMultiChapter,
  isWholeChapter = false,
  wholeChapterNum,
  scrollToVerse,
  onScrollHandled,
  onClose,
  synced = false,
  onSyncToggle,
}: PassageNotesPaneProps) {
  const { t } = useTranslation();
  const paneRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);

  // Book-level notes opt-in
  const [showBookNotes, setShowBookNotes] = useState(() => {
    try { return localStorage.getItem("structura:showBookNotes") === "true"; } catch { return false; }
  });
  const [bookNoteContent, setBookNoteContent] = useState("{}");
  const [bookNoteLoaded, setBookNoteLoaded] = useState(false);

  useEffect(() => {
    if (!showBookNotes) return;
    setBookNoteLoaded(false);
    const key = `book:${book}`;
    fetch(`/api/notes?keys=${encodeURIComponent(key)}`)
      .then((r) => r.json())
      .then((data: Record<string, { content: string }>) => {
        setBookNoteContent(data[key]?.content ?? "{}");
        setBookNoteLoaded(true);
      })
      .catch(() => { setBookNoteContent("{}"); setBookNoteLoaded(true); });
  }, [book, showBookNotes]);

  function toggleShowBookNotes() {
    setShowBookNotes((v) => {
      const next = !v;
      try { localStorage.setItem("structura:showBookNotes", String(next)); } catch {}
      return next;
    });
  }

  // Build ordered sections: [passage note →] [chapter note →] verse notes
  const sections: NoteSection[] = [];

  // 1. Passage-level note — only when this pane is showing an actual passage
  if (passageId != null && passageLabel != null) {
    sections.push({
      key: `passage:${passageId}`,
      noteType: "passage",
      label: t("notes.passageNoteLabel", { label: passageLabel }),
      book,
      chapter: isWholeChapter ? wholeChapterNum : undefined,
    });
  }

  // 2. Per-chapter and per-verse notes
  const chaptersSeen = new Set<number>();
  for (const { ch, v } of orderedVerses) {
    if (isMultiChapter && !chaptersSeen.has(ch)) {
      chaptersSeen.add(ch);
      sections.push({
        key: `chapter:${book}.${ch}`,
        noteType: "chapter",
        label: t("notes.chapterNoteLabel", { bookName, chapter: String(ch) }),
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

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
    else setQuery("");
  }, [searchOpen]);

  // Compute matching sections
  const q = query.trim().toLowerCase();
  const matchingSections = !q
    ? []
    : sections.filter((s) => {
        if (s.label.toLowerCase().includes(q)) return true;
        const text = extractTextFromTipTap(noteContents[s.key] ?? "{}");
        return text.toLowerCase().includes(q);
      });

  // Reset match index when query changes
  useEffect(() => {
    setMatchIndex(0);
  }, [q]);

  // Scroll to current match
  useEffect(() => {
    if (!q || matchingSections.length === 0 || !paneRef.current) return;
    const section = matchingSections[matchIndex];
    if (!section) return;
    const el = paneRef.current.querySelector(`[data-note-key="${CSS.escape(section.key)}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchIndex, q]);

  function goNext() {
    if (matchingSections.length === 0) return;
    setMatchIndex((i) => (i + 1) % matchingSections.length);
  }
  function goPrev() {
    if (matchingSections.length === 0) return;
    setMatchIndex((i) => (i - 1 + matchingSections.length) % matchingSections.length);
  }

  // Cmd/Ctrl+F → open search bar
  // Cmd/Ctrl+G → next match, Cmd/Ctrl+Shift+G → previous match
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === "g") {
        if (!searchOpen || !q) return;
        e.preventDefault();
        e.shiftKey ? goPrev() : goNext();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen, q, matchingSections.length]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] shrink-0">
        {!searchOpen && (
          <h2 className="text-sm font-semibold flex-1" style={{ color: "var(--foreground)" }}>
            {t("notes.panelTitle")}
          </h2>
        )}
        {searchOpen && (
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearchOpen(false);
              if (e.key === "Enter") { e.shiftKey ? goPrev() : goNext(); }
            }}
            placeholder="Search notes…"
            className="flex-1 text-xs px-2 py-1 rounded border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
        )}
        {/* Match counter + navigation arrows (shown while searching with a query) */}
        {searchOpen && q && (
          <>
            <span className="text-xs text-stone-400 dark:text-stone-500 shrink-0 tabular-nums">
              {matchingSections.length === 0
                ? "0"
                : `${matchIndex + 1}/${matchingSections.length}`}
            </span>
            <button
              onClick={goPrev}
              disabled={matchingSections.length === 0}
              title="Previous match (Shift+Enter)"
              className="w-5 h-5 flex items-center justify-center rounded text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            >
              ▲
            </button>
            <button
              onClick={goNext}
              disabled={matchingSections.length === 0}
              title="Next match (Enter)"
              className="w-5 h-5 flex items-center justify-center rounded text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            >
              ▼
            </button>
          </>
        )}
        <button
          onClick={() => setSearchOpen((v) => !v)}
          title={searchOpen ? "Close search" : "Search notes"}
          className={[
            "w-6 h-6 flex items-center justify-center rounded text-xs transition-colors shrink-0",
            searchOpen
              ? "bg-amber-500 text-white"
              : "text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800",
          ].join(" ")}
        >
          🔍
        </button>
        {onSyncToggle && (
          <button
            onClick={onSyncToggle}
            title={synced ? "Unsync notes from scroll position" : "Sync notes to scroll position"}
            className={[
              "w-6 h-6 flex items-center justify-center rounded transition-colors shrink-0",
              synced
                ? "bg-blue-500 text-white"
                : "text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800",
            ].join(" ")}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
                 strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <path d="M2 8h12M10 5l3 3-3 3" />
              <path d="M6 11L3 8l3-3" />
            </svg>
          </button>
        )}
        <button
          onClick={onClose}
          className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 text-lg leading-none shrink-0"
          aria-label="Close notes pane"
        >
          ×
        </button>
      </div>

      {/* Book notes toggle strip */}
      <div className="shrink-0 flex items-center px-4 py-1.5 border-b" style={{ borderColor: "var(--border)" }}>
        <label className="flex items-center gap-2 cursor-pointer select-none text-xs" style={{ color: "var(--text-muted)" }}>
          <input
            type="checkbox"
            checked={showBookNotes}
            onChange={toggleShowBookNotes}
            className="rounded"
          />
          {t("notes.showBookNotes", { bookName })}
        </label>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto" ref={paneRef}>
        {/* Book-level notes at the top — when opt-in checkbox is checked */}
        {showBookNotes && (
          <div
            data-note-key={`book:${book}`}
            className="border-b border-stone-100 dark:border-stone-800"
          >
            <div
              className="px-4 pt-3 pb-1 text-xs font-semibold select-none"
              style={{ color: "var(--accent)" }}
            >
              {t("notes.bookNotesHeader", { bookName })}
            </div>
            <div className="px-2 pb-3">
              {bookNoteLoaded ? (
                <NoteEditor
                  key={`book:${book}`}
                  noteKey={`book:${book}`}
                  noteType="book"
                  initialContent={bookNoteContent}
                  book={book}
                  searchQuery={q || undefined}
                />
              ) : (
                <div className="px-2 py-2 text-xs" style={{ color: "var(--text-muted)" }}>{t("notes.loading")}</div>
              )}
            </div>
          </div>
        )}

        <ChapterSummarySection
          metaKey={isWholeChapter && wholeChapterNum != null
            ? `meta:chapter:${book}.${wholeChapterNum}`
            : `meta:passage:${passageId}`}
          sermonKey={isWholeChapter && wholeChapterNum != null
            ? `sermon:chapter:${book}.${wholeChapterNum}`
            : `sermon:passage:${passageId}`}
          book={book}
          chapter={isWholeChapter ? wholeChapterNum : undefined}
          searchQuery={q || undefined}
        />
        {!loaded ? (
          <div className="px-4 py-6 text-xs text-stone-400 dark:text-stone-500">Loading…</div>
        ) : (
          sections.map((section) => {
            return (
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
                    searchQuery={q || undefined}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
