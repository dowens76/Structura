"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import HomeLink from "@/components/ui/HomeLink";
import { tokenizeTranslationText, decodeUsfmToken } from "@/lib/utils/translationTokens";

const HEBREW_FONT: React.CSSProperties = { fontFamily: '"Ezra SIL", "SBL Hebrew", serif' };
function isHebrew(s: string): boolean { return /[א-ת]/.test(s); }
function hebrewStyle(s: string): React.CSSProperties { return isHebrew(s) ? HEBREW_FONT : {}; }

const OPTION_PALETTE = ["#b91c1c", "#c2410c", "#a16207", "#166534", "#0f766e", "#1d4ed8", "#6d28d9", "#be185d"];
function colorForIndex(i: number): string { return OPTION_PALETTE[i % OPTION_PALETTE.length]; }

// Shared with ChapterDisplay's "hide source text" toggle so the preference
// is consistent across the reading view and this editor.
function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function writeLocal<T>(key: string, value: T): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota exceeded */ }
}

interface ColumnOption { id: number; value: string; color: string | null; sortOrder: number }
interface Column { id: number; tagName: string; name: string; type: "text" | "list"; sortOrder: number; options?: ColumnOption[] }
interface OccurrenceValue { optionIds: number[]; text: string | null }
interface SourceToken { text: string; wordId: string }
interface Occurrence {
  wordId: string; tagId: number; osisRef: string; book: string; chapter: number; verse: number;
  textSource: string;
  reference: string; sourceText: string; sourceTokens: SourceToken[] | null; sourceTextSource: string | null;
  translationText: string;
  values: Record<number, OccurrenceValue>;
}
interface TranslationInfo { id: number; abbreviation: string; name: string }
interface TagInfo { name: string; type: string; color: string; books: string[]; highlighted: boolean; tagIds: number[] }
interface OccurrencesData { tag: TagInfo; translationOnly: boolean; translations: TranslationInfo[]; columns: Column[]; occurrences: Occurrence[] }

function typeBadge(type: string): string {
  if (type === "word" || type === "cluster") return "L";
  if (type === "search") return "S";
  return "C";
}

export default function ConceptEditorPanel({ tagName }: { tagName: string }) {
  const [data, setData] = useState<OccurrencesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [translationId, setTranslationId] = useState<number | null>(null);
  const [hideSourceText, setHideSourceText] = useState(false);
  const hideSourceInitialized = useRef(false);

  const load = useCallback(async (transId: number | null) => {
    setError(null);
    try {
      const qs = new URLSearchParams({ tagName });
      if (transId != null) qs.set("translationId", String(transId));
      const res = await fetch(`/api/word-tags/occurrences?${qs.toString()}`);
      if (!res.ok) throw new Error("Failed to load");
      const d: OccurrencesData = await res.json();
      if (transId == null && d.translations.length > 0) {
        // No translation selected yet — pick the first one and refetch with
        // it so the Translation Text column is populated on first load.
        setTranslationId(d.translations[0].id);
        await load(d.translations[0].id);
        return;
      }
      if (!hideSourceInitialized.current) {
        hideSourceInitialized.current = true;
        // In a Translation Only workspace, default to hiding source text —
        // same precedent as ChapterDisplay's hideSourceText — but still let
        // the user toggle it back on, and respect any stored preference.
        setHideSourceText(d.translationOnly || readLocal<boolean>("structura:hideSourceText", false));
      }
      setData(d);
    } catch {
      setError("Failed to load this list.");
    } finally {
      setLoading(false);
    }
  }, [tagName]);

  useEffect(() => { load(null); }, [load]);

  function handleTranslationChange(id: number) {
    setTranslationId(id);
    load(id);
  }

  function toggleSourceText() {
    setHideSourceText((prev) => {
      const next = !prev;
      writeLocal("structura:hideSourceText", next);
      return next;
    });
  }

  async function refresh() {
    await load(translationId);
  }

  async function handleToggleHighlight() {
    if (!data) return;
    const next = !data.tag.highlighted;
    setData({ ...data, tag: { ...data.tag, highlighted: next } });
    try {
      await Promise.all(data.tag.tagIds.map((id) =>
        fetch(`/api/word-tags/${id}/highlight`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ highlighted: next }),
        })
      ));
    } catch {
      setData((prev) => prev ? { ...prev, tag: { ...prev.tag, highlighted: !next } } : prev);
    }
  }

  /** Add or remove a single word from a tag — the same
   *  `/api/word-tag-refs` upsert the chapter reading view's own tag-editing
   *  mode uses, so a word added or removed here behaves identically there. */
  async function handleToggleWord(opts: {
    wordId: string; tagId: number; book: string; chapter: number; source: string; isMember: boolean;
  }) {
    await fetch("/api/word-tag-refs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wordId: opts.wordId,
        tagId: opts.isMember ? null : opts.tagId,
        book: opts.book,
        chapter: opts.chapter,
        source: opts.source,
      }),
    });
    await refresh();
  }

  async function handleAddColumn(name: string, type: "text" | "list") {
    await fetch("/api/word-tags/columns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagName, name, type }),
    });
    await refresh();
  }

  async function handleRenameColumn(columnId: number, name: string) {
    await fetch(`/api/word-tags/columns/${columnId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await refresh();
  }

  async function handleDeleteColumn(columnId: number) {
    await fetch(`/api/word-tags/columns/${columnId}`, { method: "DELETE" });
    await refresh();
  }

  async function handleReorderColumns(orderedIds: number[]) {
    await Promise.all(orderedIds.map((id, idx) =>
      fetch(`/api/word-tags/columns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: idx }),
      })
    ));
    await refresh();
  }

  /** A multi-word phrase shares one Tags-column row, so every value edit
   *  applies to all of the phrase's underlying words together — this sets
   *  each wordId to the SAME target state (rather than naively toggling each
   *  one from its own current state, which could leave them out of sync if
   *  they'd ever been edited individually before). */
  async function handleToggleOption(columnId: number, wordIds: string[], optionId: number, currentlySelected: boolean) {
    const targetSelected = !currentlySelected;
    await Promise.all(wordIds.map((wordId) => {
      const occ = data?.occurrences.find((o) => o.wordId === wordId);
      const hasOption = occ?.values[columnId]?.optionIds.includes(optionId) ?? false;
      if (hasOption === targetSelected) return Promise.resolve();
      return fetch(`/api/word-tags/columns/${columnId}/values`, {
        method: targetSelected ? "PUT" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, optionId }),
      });
    }));
    await refresh();
  }

  async function handleCreateOption(columnId: number, wordIds: string[], value: string) {
    const res = await fetch(`/api/word-tags/columns/${columnId}/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    const opt = await res.json();
    await Promise.all(wordIds.map((wordId) =>
      fetch(`/api/word-tags/columns/${columnId}/values`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, optionId: opt.id }),
      })
    ));
    await refresh();
  }

  async function handleSetText(columnId: number, wordIds: string[], textValue: string) {
    await Promise.all(wordIds.map((wordId) =>
      fetch(`/api/word-tags/columns/${columnId}/values`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, textValue }),
      })
    ));
    await refresh();
  }

  if (loading) {
    return <div className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</div>;
  }
  if (error) {
    return <div className="text-sm text-red-500">{error}</div>;
  }
  if (!data) return null;

  const translationAbbr = data.translations.find((t) => t.id === translationId)?.abbreviation ?? null;
  // "N occurrences" should count phrases, not individual tagged words — a
  // contiguous run like "ὁ πιστεύων" is one occurrence, not two.
  const occurrenceCount = groupOccurrencesByVerse(data.occurrences, translationAbbr)
    .reduce((sum, g) => sum + g.phraseCount, 0);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-4 mb-4">
          <HomeLink />
          <Link
            href="/export/lists"
            className="flex items-center gap-1.5 text-sm transition-colors hover:opacity-70 w-fit"
            style={{ color: "var(--text-muted)" }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to Manage Lists
          </Link>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: data.tag.color }} />
          <h1 className="text-2xl font-semibold" style={{ color: "var(--foreground)", ...hebrewStyle(data.tag.name) }}>
            {data.tag.name}
          </h1>
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-50" style={{ color: data.tag.color }}>
            {typeBadge(data.tag.type)}
          </span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {data.tag.books.join(", ")} · {occurrenceCount} occurrence{occurrenceCount !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>Translation:</span>
          <select
            value={translationId ?? ""}
            onChange={(e) => handleTranslationChange(parseInt(e.target.value))}
            className="text-xs px-2 py-1 rounded border"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
          >
            {data.translations.length === 0 && <option value="">No translations imported</option>}
            {data.translations.map((t) => (
              <option key={t.id} value={t.id}>{t.abbreviation} — {t.name}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "var(--text-muted)" }}>
          <input type="checkbox" checked={!hideSourceText} onChange={toggleSourceText} />
          Show source text
        </label>
        <label
          className="flex items-center gap-1.5 text-xs cursor-pointer"
          style={{ color: "var(--text-muted)" }}
          title="Highlight this tag's occurrences when reading the chapter"
        >
          <input type="checkbox" checked={data.tag.highlighted} onChange={handleToggleHighlight} />
          Highlight in reading view
        </label>
      </div>

      <OccurrenceTable
        data={data}
        showSourceText={!hideSourceText}
        translationAbbr={translationAbbr}
        onAddColumn={handleAddColumn}
        onRenameColumn={handleRenameColumn}
        onDeleteColumn={handleDeleteColumn}
        onReorderColumns={handleReorderColumns}
        onToggleOption={handleToggleOption}
        onCreateOption={handleCreateOption}
        onSetText={handleSetText}
        onToggleWord={handleToggleWord}
      />
    </div>
  );
}

// ─── Occurrence table ───────────────────────────────────────────────────────

interface OccurrenceTableProps {
  data: OccurrencesData;
  showSourceText: boolean;
  /** Abbreviation of the currently-selected translation, needed to build/parse
   *  tv: ids when toggling a word in the Translation Text column. */
  translationAbbr: string | null;
  onAddColumn: (name: string, type: "text" | "list") => Promise<void>;
  onRenameColumn: (columnId: number, name: string) => Promise<void>;
  onDeleteColumn: (columnId: number) => Promise<void>;
  onReorderColumns: (orderedIds: number[]) => Promise<void>;
  onToggleOption: (columnId: number, wordIds: string[], optionId: number, currentlySelected: boolean) => Promise<void>;
  onCreateOption: (columnId: number, wordIds: string[], value: string) => Promise<void>;
  onSetText: (columnId: number, wordIds: string[], textValue: string) => Promise<void>;
  onToggleWord: (opts: { wordId: string; tagId: number; book: string; chapter: number; source: string; isMember: boolean }) => Promise<void>;
}

/** One row's worth of occurrences: every tagged word that falls in the same
 *  verse, so the verse itself only has to be shown once. */
interface VerseGroup {
  osisRef: string;
  reference: string;
  book: string;
  chapter: number;
  verse: number;
  /** Every member necessarily shares one tag row (a verse belongs to one book,
   *  and tag rows are keyed by book), so this is safe to use for new refs too. */
  tagId: number;
  sourceText: string;
  sourceTokens: SourceToken[] | null;
  sourceTextSource: string | null;
  translationText: string;
  members: Occurrence[];
  /** wordId -> 1-based phrase number within this verse. A contiguous run of
   *  tagged words with nothing but punctuation between them (e.g. "ὁ
   *  πιστεύων") is one phrase and shares a number — see phraseCount below. */
  phraseNumberByWordId: Map<string, number>;
  /** Distinct phrases in this verse — what "N occurrences" should actually count. */
  phraseCount: number;
  /** Each phrase's own member occurrences, in phrase-number order — one Tags
   *  column row per phrase, not per underlying word, since a multi-word
   *  phrase's tag values apply to the whole phrase together. */
  phrases: Occurrence[][];
}

/** True for a token that carries no letters or digits — i.e. it's punctuation
 *  on its own, not a word. A standalone token like this never itself forces a
 *  phrase break — only the specific marks in PHRASE_BREAK_CHARS do (checked
 *  separately) — but any other stray symbol shouldn't block a phrase from
 *  spanning across it either. */
function isPunctuationOnlyToken(text: string): boolean {
  return !/[\p{L}\p{N}]/u.test(text);
}

/** Marks that end a phrase wherever they appear, whether trailing the
 *  previous tagged word or leading the next one — sentence/clause-final
 *  punctuation and quotation marks. Deliberately narrower than "any
 *  punctuation": a hyphen, maqqef, or raised interpunct-free comma-less list
 *  shouldn't split a phrase, but ". , ; ? !" and quote marks should. Includes
 *  the Greek-specific equivalents (·  for semicolon, ; for question mark). */
const PHRASE_BREAK_CHARS = new Set([
  ".", ",", ";", "?", "!",
  "·", // Greek ano teleia — functions as a semicolon
  ";", // Greek question mark (distinct codepoint from ";")
  '"', "'", "‘", "’", "“", "”",
]);

function endsWithPhraseBreak(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && PHRASE_BREAK_CHARS.has(t.slice(-1));
}
function startsWithPhraseBreak(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && PHRASE_BREAK_CHARS.has(t.slice(0, 1));
}

/** Merges a position-sorted bucket of same-space occurrences into phrases.
 *  Two tagged words join the same phrase only when they're contiguous (the
 *  very next position, or with only non-breaking punctuation-only tokens
 *  between) AND neither the trailing edge of the earlier word nor the
 *  leading edge of the later one carries a phrase-break mark — a comma,
 *  period, etc. always ends the phrase there even when the next tagged word
 *  is immediately adjacent. */
function mergeIntoPhrases(
  bucket: { occ: Occurrence; pos: number }[],
  tokenTextAt: (pos: number) => string | null | undefined
): Occurrence[][] {
  const sorted = [...bucket].sort((a, b) => a.pos - b.pos);
  const phrases: { occs: Occurrence[]; lastPos: number }[] = [];
  for (const { occ, pos } of sorted) {
    const cur = phrases[phrases.length - 1];
    if (cur) {
      const lastText = tokenTextAt(cur.lastPos);
      const nextText = tokenTextAt(pos);
      const hardBreak =
        (lastText != null && endsWithPhraseBreak(lastText)) ||
        (nextText != null && startsWithPhraseBreak(nextText));

      let contiguous = false;
      if (!hardBreak) {
        if (pos === cur.lastPos + 1) {
          contiguous = true;
        } else if (pos > cur.lastPos + 1) {
          contiguous = true;
          for (let p = cur.lastPos + 1; p < pos; p++) {
            const text = tokenTextAt(p);
            if (
              text == null || !isPunctuationOnlyToken(text) ||
              endsWithPhraseBreak(text) || startsWithPhraseBreak(text)
            ) { contiguous = false; break; }
          }
        }
      }
      if (contiguous) {
        cur.occs.push(occ);
        cur.lastPos = pos;
        continue;
      }
    }
    phrases.push({ occs: [occ], lastPos: pos });
  }
  return phrases.map((p) => p.occs);
}

/** Groups occurrences that share a verse, preserving the backend's canonical
 *  (book/chapter/verse) ordering, and within each verse further groups
 *  contiguous same-tag words into phrases (see mergeIntoPhrases) so e.g. "ὁ
 *  πιστεύων" counts and numbers as one occurrence rather than two.
 *  `translationAbbr` is needed to resolve tv:-prefixed members' own token
 *  position and check for punctuation between them; a tv: member tagged
 *  under some other translation than the one currently displayed can only
 *  be checked for strict (gap-of-one) adjacency, since that translation's
 *  text isn't loaded here. */
function groupOccurrencesByVerse(occurrences: Occurrence[], translationAbbr: string | null): VerseGroup[] {
  const groups: Omit<VerseGroup, "phraseNumberByWordId" | "phraseCount" | "phrases">[] = [];
  const indexByRef = new Map<string, number>();
  for (const occ of occurrences) {
    let idx = indexByRef.get(occ.osisRef);
    if (idx === undefined) {
      idx = groups.length;
      indexByRef.set(occ.osisRef, idx);
      groups.push({
        osisRef: occ.osisRef,
        reference: occ.reference,
        book: occ.book,
        chapter: occ.chapter,
        verse: occ.verse,
        tagId: occ.tagId,
        sourceText: occ.sourceText,
        sourceTokens: occ.sourceTokens,
        sourceTextSource: occ.sourceTextSource,
        translationText: occ.translationText,
        members: [],
      });
    }
    groups[idx].members.push(occ);
  }

  return groups.map((group) => {
    const sourceBucket: { occ: Occurrence; pos: number }[] = [];
    const tvBuckets = new Map<string, { occ: Occurrence; pos: number }[]>();
    const unresolved: Occurrence[] = [];

    for (const occ of group.members) {
      if (occ.wordId.startsWith("tv:")) {
        const parts = occ.wordId.split(":");
        const abbr = parts[1] ?? "";
        const posStr = parts[2]?.split(".").pop();
        const pos = posStr != null ? parseInt(posStr, 10) : NaN;
        if (isNaN(pos)) { unresolved.push(occ); continue; }
        const arr = tvBuckets.get(abbr) ?? [];
        arr.push({ occ, pos });
        tvBuckets.set(abbr, arr);
      } else if (group.sourceTokens) {
        const pos = group.sourceTokens.findIndex((t) => t.wordId === occ.wordId);
        if (pos === -1) { unresolved.push(occ); continue; }
        sourceBucket.push({ occ, pos });
      } else {
        unresolved.push(occ);
      }
    }

    const translationTokens = translationAbbr
      ? tokenizeTranslationText(group.translationText).map((t) => decodeUsfmToken(t).display)
      : null;

    const sourcePhrases = mergeIntoPhrases(sourceBucket, (p) => group.sourceTokens?.[p]?.text);
    const tvPhrases = [...tvBuckets.entries()].flatMap(([abbr, bucket]) =>
      mergeIntoPhrases(bucket, (p) => (abbr === translationAbbr ? translationTokens?.[p] : null))
    );
    const allPhrases = [...sourcePhrases, ...tvPhrases, ...unresolved.map((o) => [o])];

    const phraseNumberByWordId = new Map<string, number>();
    const orderedMembers: Occurrence[] = [];
    allPhrases.forEach((phraseOccs, i) => {
      for (const occ of phraseOccs) {
        phraseNumberByWordId.set(occ.wordId, i + 1);
        orderedMembers.push(occ);
      }
    });

    return { ...group, members: orderedMembers, phraseNumberByWordId, phraseCount: allPhrases.length, phrases: allPhrases };
  });
}

/** Small colored badge used to tie a highlighted word in the source text back
 *  to its own row of column values, when a verse has more than one occurrence. */
function OccurrenceBadge({ n, color }: { n: number; color: string }) {
  return (
    <span
      className="inline-flex items-center justify-center shrink-0 rounded-full text-[9px] font-bold text-white leading-none"
      style={{ backgroundColor: color, width: "14px", height: "14px" }}
    >
      {n}
    </span>
  );
}

/** Renders a verse's word tokens with this tag's occurrences highlighted, and
 *  every token clickable — clicking a highlighted word removes it from the
 *  tag, clicking any other word adds it. Shared by the Source Text and
 *  Translation Text columns; the caller supplies each token's own wordId. */
function ClickableTokens({ tokens, phraseNumberByWordId, showBadges, color, onToggle, hebrew }: {
  tokens: { key: string; text: string; wordId: string }[];
  phraseNumberByWordId: Map<string, number>;
  /** Whether to show phrase-number badges at all — false when the whole verse
   *  is just one phrase, so numbering it would be noise. */
  showBadges: boolean;
  color: string;
  onToggle: (wordId: string, isMember: boolean) => void;
  hebrew?: boolean;
}) {
  return (
    <span>
      {tokens.map((tok, i) => {
        const n = phraseNumberByWordId.get(tok.wordId);
        const isMember = n != null;
        return (
          <span key={tok.key}>
            {i > 0 && " "}
            <span
              role="button"
              title={isMember ? "Remove from this list" : "Add to this list"}
              onClick={() => onToggle(tok.wordId, isMember)}
              className={[
                "rounded px-0.5 inline-flex items-center gap-0.5 cursor-pointer transition-colors",
                isMember ? "" : "hover:bg-stone-200 dark:hover:bg-stone-700",
              ].join(" ")}
              style={isMember ? { backgroundColor: `${color}2a` } : undefined}
            >
              {isMember && showBadges && <OccurrenceBadge n={n} color={color} />}
              <span style={hebrew ? HEBREW_FONT : undefined}>{tok.text}</span>
            </span>
          </span>
        );
      })}
    </span>
  );
}

function OccurrenceTable({
  data, showSourceText, translationAbbr, onAddColumn, onRenameColumn, onDeleteColumn, onReorderColumns, onToggleOption, onCreateOption, onSetText, onToggleWord,
}: OccurrenceTableProps) {
  const [showAddColumn, setShowAddColumn] = useState(false);
  const dragIdx = useRef<number | null>(null);
  const [dragOrder, setDragOrder] = useState<number[] | null>(null);

  const columns = dragOrder
    ? dragOrder.map((id) => data.columns.find((c) => c.id === id)!).filter(Boolean)
    : data.columns;

  const verseGroups = groupOccurrencesByVerse(data.occurrences, translationAbbr);

  function handleDragStart(idx: number) {
    dragIdx.current = idx;
    setDragOrder(data.columns.map((c) => c.id));
  }
  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx || !dragOrder) return;
    const next = [...dragOrder];
    const [moved] = next.splice(dragIdx.current, 1);
    next.splice(idx, 0, moved);
    dragIdx.current = idx;
    setDragOrder(next);
  }
  async function handleDragEnd() {
    dragIdx.current = null;
    if (dragOrder) await onReorderColumns(dragOrder);
    setDragOrder(null);
  }

  return (
    <div className="rounded-lg border overflow-x-auto" style={{ borderColor: "var(--border)" }}>
      <table className="min-w-full text-xs border-collapse">
        <thead>
          <tr style={{ backgroundColor: "var(--surface-muted, var(--surface))" }}>
            <th className="text-left px-3 py-2 font-semibold whitespace-nowrap" style={{ color: "var(--foreground)" }}>Reference</th>
            {showSourceText && (
              <th className="text-left px-3 py-2 font-semibold whitespace-nowrap" style={{ color: "var(--foreground)" }}>Source Text</th>
            )}
            <th className="text-left px-3 py-2 font-semibold whitespace-nowrap" style={{ color: "var(--foreground)" }}>Translation Text</th>
            {columns.map((col, idx) => (
              <th
                key={col.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={handleDragEnd}
                className="text-left px-3 py-2 font-semibold whitespace-nowrap cursor-grab active:cursor-grabbing select-none"
                style={{ color: "var(--foreground)" }}
              >
                <ColumnHeader column={col} onRename={onRenameColumn} onDelete={onDeleteColumn} />
              </th>
            ))}
            <th className="px-3 py-2 whitespace-nowrap relative">
              {!showAddColumn ? (
                <button type="button" onClick={() => setShowAddColumn(true)}
                  className="text-xs px-2 py-1 rounded border border-dashed transition-colors hover:border-blue-400 hover:text-blue-500"
                  style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                  + Column
                </button>
              ) : (
                <AddColumnForm
                  onSave={async (name, type) => { await onAddColumn(name, type); setShowAddColumn(false); }}
                  onCancel={() => setShowAddColumn(false)}
                />
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {verseGroups.map((group) => {
            const showBadges = group.phraseCount > 1;
            return (
              <tr key={group.osisRef} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="px-3 py-2 whitespace-nowrap align-top" style={{ color: "var(--foreground)" }}>{group.reference}</td>
                {showSourceText && (
                  <td className="px-3 py-2 align-top" style={hebrewStyle(group.sourceText)}>
                    {group.sourceTokens ? (
                      <ClickableTokens
                        tokens={group.sourceTokens.map((t) => ({ key: t.wordId, text: t.text, wordId: t.wordId }))}
                        phraseNumberByWordId={group.phraseNumberByWordId}
                        showBadges={showBadges}
                        color={data.tag.color}
                        hebrew={isHebrew(group.sourceText)}
                        onToggle={(wordId, isMember) => onToggleWord({
                          wordId, tagId: group.tagId, book: group.book, chapter: group.chapter,
                          source: group.sourceTextSource ?? group.members[0].textSource, isMember,
                        })}
                      />
                    ) : (
                      group.sourceText
                    )}
                  </td>
                )}
                <td className="px-3 py-2 align-top" style={{ color: "var(--text-muted)" }}>
                  {translationAbbr && group.translationText ? (
                    <ClickableTokens
                      tokens={tokenizeTranslationText(group.translationText).map((tok, wi) => ({
                        key: `${wi}`,
                        text: decodeUsfmToken(tok).display,
                        wordId: `tv:${translationAbbr}:${group.book}.${group.chapter}.${group.verse}.${wi}`,
                      }))}
                      phraseNumberByWordId={group.phraseNumberByWordId}
                      showBadges={showBadges}
                      color={data.tag.color}
                      onToggle={(wordId, isMember) => onToggleWord({
                        wordId, tagId: group.tagId, book: group.book, chapter: group.chapter,
                        source: translationAbbr, isMember,
                      })}
                    />
                  ) : (
                    group.translationText
                  )}
                </td>
                {columns.map((col) => (
                  <td key={col.id} className="px-3 py-2 align-top" style={{ minWidth: "10rem" }}>
                    <div className="flex flex-col gap-1.5">
                      {group.phrases.map((phraseOccs, i) => {
                        const rep = phraseOccs[0];
                        const wordIds = phraseOccs.map((o) => o.wordId);
                        return (
                          <div key={rep.wordId} className="flex items-start gap-1.5">
                            {showBadges && <OccurrenceBadge n={i + 1} color={data.tag.color} />}
                            {col.type === "list" ? (
                              <ListCell
                                column={col}
                                value={rep.values[col.id] ?? { optionIds: [], text: null }}
                                onToggleOption={(optionId, selected) => onToggleOption(col.id, wordIds, optionId, selected)}
                                onCreateOption={(value) => onCreateOption(col.id, wordIds, value)}
                              />
                            ) : (
                              <TextCell
                                initialValue={rep.values[col.id]?.text ?? ""}
                                onSave={(text) => onSetText(col.id, wordIds, text)}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </td>
                ))}
                <td />
              </tr>
            );
          })}
          {verseGroups.length === 0 && (
            <tr>
              <td colSpan={(showSourceText ? 3 : 2) + columns.length + 1} className="px-3 py-6 text-center" style={{ color: "var(--text-muted)" }}>
                No occurrences found for this list.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Column header (rename / delete) ────────────────────────────────────────

function ColumnHeader({
  column, onRename, onDelete,
}: { column: Column; onRename: (id: number, name: string) => Promise<void>; onDelete: (id: number) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(column.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === "Enter" && name.trim()) { await onRename(column.id, name.trim()); setEditing(false); }
            if (e.key === "Escape") { setName(column.name); setEditing(false); }
          }}
          className="w-24 text-xs bg-transparent outline-none border-b"
          style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 group">
      <span onDoubleClick={() => setEditing(true)} title="Double-click to rename">{column.name}</span>
      {confirmDelete ? (
        <>
          <span role="button" className="text-green-600 dark:text-green-400 font-bold text-xs px-0.5" onClick={() => onDelete(column.id)}>✓</span>
          <span role="button" className="text-stone-400 text-xs px-0.5" onClick={() => setConfirmDelete(false)}>✕</span>
        </>
      ) : (
        <span
          role="button"
          onClick={() => setConfirmDelete(true)}
          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-stone-400 hover:text-red-500 transition-opacity leading-none"
          title="Delete column"
        >
          ×
        </span>
      )}
    </div>
  );
}

// ─── Add column form ─────────────────────────────────────────────────────────

function AddColumnForm({ onSave, onCancel }: { onSave: (name: string, type: "text" | "list") => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"text" | "list">("list");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try { await onSave(name.trim(), type); } finally { setSaving(false); }
  }

  return (
    <div className="absolute z-50 mt-1 rounded-lg border shadow-lg p-3 w-56"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onCancel(); }}
        placeholder="Column name"
        className="w-full text-xs px-2 py-1 rounded border mb-2"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--foreground)" }}
      />
      <div className="flex rounded overflow-hidden border text-xs mb-2" style={{ borderColor: "var(--border)" }}>
        {(["list", "text"] as const).map((tp) => (
          <button key={tp} type="button" onClick={() => setType(tp)}
            className="flex-1 px-2 py-1 capitalize transition-colors"
            style={{ backgroundColor: type === tp ? "var(--accent)" : "transparent", color: type === tp ? "#fff" : "var(--text-muted)" }}>
            {tp === "list" ? "List" : "Text"}
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-xs px-2 py-0.5 rounded" style={{ color: "var(--text-muted)" }}>Cancel</button>
        <button type="button" onClick={handleSave} disabled={saving || !name.trim()}
          className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
}

// ─── List-type cell ──────────────────────────────────────────────────────────

function ListCell({
  column, value, onToggleOption, onCreateOption,
}: {
  column: Column;
  value: OccurrenceValue;
  onToggleOption: (optionId: number, currentlySelected: boolean) => Promise<void>;
  onCreateOption: (value: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const options = column.options ?? [];
  const selected = new Set(value.optionIds);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const filtered = options.filter((o) => o.value.toLowerCase().includes(query.trim().toLowerCase()));
  const exactMatch = options.some((o) => o.value.toLowerCase() === query.trim().toLowerCase());

  async function handleCreate() {
    if (!query.trim() || busy) return;
    setBusy(true);
    try { await onCreateOption(query.trim()); setQuery(""); } finally { setBusy(false); }
  }

  return (
    <div className="relative" ref={ref}>
      <div className="flex flex-wrap gap-1 items-center">
        {[...selected].map((optId) => {
          const opt = options.find((o) => o.id === optId);
          if (!opt) return null;
          const idx = options.findIndex((o) => o.id === optId);
          const color = opt.color ?? colorForIndex(idx);
          return (
            <span key={optId} className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border"
              style={{ borderColor: color, color: "var(--foreground)", ...hebrewStyle(opt.value) }}>
              {opt.value}
              <button type="button" onClick={() => onToggleOption(optId, true)} className="opacity-50 hover:opacity-100 leading-none">×</button>
            </span>
          );
        })}
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="text-[10px] px-1.5 py-0.5 rounded-full border border-dashed transition-colors hover:border-blue-400 hover:text-blue-500"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          +
        </button>
      </div>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 rounded-lg border shadow-lg p-2 w-48"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !exactMatch) handleCreate(); }}
            placeholder="Search or create…"
            className="w-full text-xs px-1.5 py-1 rounded border mb-1.5"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--foreground)" }}
          />
          <div className="max-h-40 overflow-y-auto flex flex-col gap-0.5">
            {filtered.map((opt) => {
              const idx = options.findIndex((o) => o.id === opt.id);
              const color = opt.color ?? colorForIndex(idx);
              const isSelected = selected.has(opt.id);
              return (
                <button key={opt.id} type="button"
                  onClick={() => onToggleOption(opt.id, isSelected)}
                  className="flex items-center gap-1.5 text-left text-xs px-1.5 py-1 rounded transition-colors hover:bg-stone-100 dark:hover:bg-stone-800"
                  style={{ color: "var(--foreground)" }}>
                  <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="flex-1 truncate" style={hebrewStyle(opt.value)}>{opt.value}</span>
                  {isSelected && <span className="text-[10px] opacity-60">✓</span>}
                </button>
              );
            })}
            {query.trim() && !exactMatch && (
              <button type="button" onClick={handleCreate} disabled={busy}
                className="text-left text-xs px-1.5 py-1 rounded transition-colors hover:bg-stone-100 dark:hover:bg-stone-800"
                style={{ color: "var(--accent)" }}>
                + Create &ldquo;{query.trim()}&rdquo;
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Text-type cell ──────────────────────────────────────────────────────────

function TextCell({ initialValue, onSave }: { initialValue: string; onSave: (text: string) => Promise<void> }) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => { setValue(initialValue); }, [initialValue]);

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => { if (value !== initialValue) onSave(value); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="w-full text-xs bg-transparent outline-none border-b py-0.5"
      style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
    />
  );
}
