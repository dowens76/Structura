/**
 * Scripture reference parser.
 *
 * Scans a plain-text string and returns all scripture references found,
 * with their positions (for ProseMirror decorations) and a normalised OSIS ref.
 *
 * Supports English and Vietnamese book names/abbreviations from the i18n system.
 * Handles:
 *   "Gen 1"           — chapter only
 *   "Gen. 1:1"        — abbreviation with trailing period
 *   "Gen 1:1-3"       — verse range
 *   "Gen 1:1-2:3"     — cross-chapter range
 *   "Gen 1:1; 3, 5"   — series: same book + chapter, comma/semicolon-separated
 *   "Gen 1:1; 2:3"    — series: new chapter (same book)
 *
 * No React, no network — safe to call in ProseMirror plugin state updates.
 */

import { translations } from "@/lib/i18n/translations";
import { OSIS_BOOKS_OT, OSIS_BOOKS_NT } from "@/lib/utils/osis";

export interface ScriptureMatch {
  /** Raw matched text as it appears in the note */
  raw: string;
  /** Normalised OSIS ref, e.g. "John.3.16" or "Gen.1.1-Gen.1.3" */
  osisRef: string;
  /** Start character offset within the input string */
  from: number;
  /** End character offset (exclusive) */
  to: number;
}

// ─── Alias map ────────────────────────────────────────────────────────────────

type AliasMap = Map<string, string>; // normalised-lowercase-alias → OSIS code

function normalise(s: string): string {
  return s.toLowerCase().replace(/[\s\-]+/g, " ").trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildAliasMap(): AliasMap {
  const map: AliasMap = new Map();
  const allOsis = [...OSIS_BOOKS_OT, ...OSIS_BOOKS_NT];

  for (const locale of (["en", "vi"] as const)) {
    const t = translations[locale];
    for (const osis of allOsis) {
      // Full name from books.*
      const fullName = (t.books as Record<string, string>)[osis];
      if (fullName) map.set(normalise(fullName), osis);

      // Abbreviations from bookAbbreviations.*
      const abbrs = (t.bookAbbreviations as Record<string, string[]>)[osis];
      if (abbrs) {
        for (const a of abbrs) map.set(normalise(a), osis);
      }
    }
  }
  return map;
}

// Computed once at module load — safe because translations is a static constant.
const ALIAS_MAP: AliasMap = buildAliasMap();

// ─── Anchor regex ─────────────────────────────────────────────────────────────

function buildRegex(): RegExp {
  // Sort longest-first so greedy matching prefers "1 Samuel" over "Sam"
  const aliases = [...ALIAS_MAP.keys()].sort((a, b) => b.length - a.length);
  const bookPattern = aliases.map(escapeRegex).join("|");

  // Pattern breakdown:
  //   (?<!\w)          — not preceded by a word character (prevents "es" in "Verses")
  //   (book)           — captured book alias
  //   \.?              — optional trailing period on abbreviation, e.g. "Gen."
  //   \s+              — required whitespace between book and chapter
  //   (\d+)            — chapter number
  //   (?::(\d+)        — optional :verse
  //     (?:\s*[-–]\s*  — optional range dash
  //       (?:(\d+):)?  — optional end-chapter (for cross-chapter ranges)
  //       (\d+)        — end verse
  //     )?
  //   )?
  const pattern =
    `(?<!\\w)(${bookPattern})` +
    `\\.?\\s+(\\d+)` +
    `(?::(\\d+)` +
    `(?:\\s*[-–]\\s*` +
    `(?:(\\d+):)?` +
    `(\\d+)` +
    `)?` +
    `)?`;

  // Flags: g=global, i=case-insensitive (English), u=Unicode (Vietnamese diacritics)
  return new RegExp(pattern, "giu");
}

const SCRIPTURE_REGEX = buildRegex();

// ─── Series / continuation regex ─────────────────────────────────────────────

// Matches a continuation in a series: a separator ([;.,]) followed by optional
// whitespace and a reference that is either "verse" or "chapter:verse".
// Group 1 = separator + spaces  (not included in the link)
// Group 2 = the reference text  (linked)
const CONTINUATION_RE = /^([;.,]\s*)(\d+(?::\d+)?)(?!\w)/;

// ─── Public API ───────────────────────────────────────────────────────────────

export function parseScriptureRefs(text: string): ScriptureMatch[] {
  const results: ScriptureMatch[] = [];
  SCRIPTURE_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = SCRIPTURE_REGEX.exec(text)) !== null) {
    const [raw, bookAlias, chapterStr, verseStr, endChapterStr, endVerseStr] = match;

    const osis = ALIAS_MAP.get(normalise(bookAlias));
    if (!osis) continue;

    const chapter    = parseInt(chapterStr,    10);
    const verse      = verseStr      !== undefined ? parseInt(verseStr,      10) : undefined;
    const endChapter = endChapterStr !== undefined ? parseInt(endChapterStr, 10) : undefined;
    const endVerse   = endVerseStr   !== undefined ? parseInt(endVerseStr,   10) : undefined;

    let osisRef: string;
    if (verse === undefined) {
      osisRef = `${osis}.${chapter}`;
    } else if (endVerse === undefined) {
      osisRef = `${osis}.${chapter}.${verse}`;
    } else {
      const endCh = endChapter ?? chapter;
      osisRef = `${osis}.${chapter}.${verse}-${osis}.${endCh}.${endVerse}`;
    }

    results.push({
      raw,
      osisRef,
      from: match.index,
      to: match.index + raw.length,
    });

    // ── Series continuations ────────────────────────────────────────────────
    // Only scan for continuations when the anchor established a verse number,
    // e.g. "Gen 1:1; 3, 5" but not "Gen 1; 3" (chapter-only anchor is
    // ambiguous — "3" could mean Gen 3, not Gen 1:3).
    if (verse === undefined) continue;

    let pos = match.index + raw.length;
    let ctxChapter = chapter;

    while (pos < text.length) {
      const cm = CONTINUATION_RE.exec(text.slice(pos));
      if (!cm) break;

      const sepLen = cm[1].length; // skip separator + whitespace for link position
      const refStr = cm[2];        // "3" or "2:3"
      const colonIdx = refStr.indexOf(":");

      let contOsisRef: string;
      if (colonIdx !== -1) {
        // "chapter:verse" — starts a new chapter context within the same book
        const ch = parseInt(refStr.slice(0, colonIdx), 10);
        const v  = parseInt(refStr.slice(colonIdx + 1), 10);
        ctxChapter = ch;
        contOsisRef = `${osis}.${ch}.${v}`;
      } else {
        // bare number — verse in the current chapter context
        contOsisRef = `${osis}.${ctxChapter}.${parseInt(refStr, 10)}`;
      }

      results.push({
        raw: refStr,
        osisRef: contOsisRef,
        from: pos + sepLen,
        to: pos + cm[0].length,
      });

      pos += cm[0].length;
    }
  }

  return results;
}
