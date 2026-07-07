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
 * When a `context.currentBook` is supplied, book-less references are also
 * recognised and resolved against it (and `context.currentChapter` for
 * verse-only refs):
 *   "ch. 1"           — chapter in the current book
 *   "1:1"             — chapter:verse in the current book
 *   "1:1-3"           — verse range in the current book
 *   "v. 1"            — verse in the current book + current chapter
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

export interface ScriptureRefContext {
  /** OSIS code of the book the note belongs to, e.g. "Gen" */
  currentBook?: string;
  /** Chapter number the note belongs to (needed to resolve "v. N") */
  currentChapter?: number;
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

// ─── Book-less reference regexes ──────────────────────────────────────────────
// Only used when a `currentBook` context is supplied (see parseScriptureRefs).

// "ch. 5", "ch 5", "chapter 5" — chapter-only, resolved against currentBook.
const CHAPTER_ONLY_RE = /(?<!\w)ch(?:apter)?\.?\s+(\d+)(?!\w)/giu;

// "v. 3", "v 3", "verse 3" — verse-only, resolved against currentBook + currentChapter.
const VERSE_ONLY_RE = /(?<!\w)v(?:erse)?\.?\s+(\d+)(?!\w)/giu;

// "1:1", "1:1-3", "1:1-2:3" — bare chapter:verse (optionally a range), resolved
// against currentBook. Same shape as the book-anchored pattern above.
const BARE_CHAPTER_VERSE_RE =
  /(?<!\w)(\d+):(\d+)(?:\s*[-–]\s*(?:(\d+):)?(\d+))?(?!\w)/gu;

// ─── Public API ───────────────────────────────────────────────────────────────

export function parseScriptureRefs(
  text: string,
  context?: ScriptureRefContext
): ScriptureMatch[] {
  const results: ScriptureMatch[] = [];
  SCRIPTURE_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = SCRIPTURE_REGEX.exec(text)) !== null) {
    const [raw, bookAlias, chapterStr, verseStr, endChapterStr, endVerseStr] = match;

    // Require the book alias to start with an uppercase letter (or a digit
    // followed by one, for numbered books like "1 Peter") so lowercase words
    // like "is" or "es" mid-sentence don't trigger false matches.
    if (!/^(\d\s*)?\p{Lu}/u.test(bookAlias)) continue;

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

  // ── Book-less references ──────────────────────────────────────────────────
  // Resolved against the current book/chapter when supplied. Skips any span
  // already claimed by a book-anchored match or series continuation above.
  if (context?.currentBook) {
    const book = context.currentBook;
    const occupied: Array<[number, number]> = results.map((r) => [r.from, r.to]);
    const overlaps = (from: number, to: number) =>
      occupied.some(([of, ot]) => from < ot && to > of);
    const claim = (from: number, to: number) => occupied.push([from, to]);

    let bm: RegExpExecArray | null;

    CHAPTER_ONLY_RE.lastIndex = 0;
    while ((bm = CHAPTER_ONLY_RE.exec(text)) !== null) {
      const from = bm.index;
      const to = from + bm[0].length;
      if (!overlaps(from, to)) {
        results.push({ raw: bm[0], osisRef: `${book}.${parseInt(bm[1], 10)}`, from, to });
        claim(from, to);
      }
    }

    if (context.currentChapter !== undefined) {
      const chapter = context.currentChapter;
      VERSE_ONLY_RE.lastIndex = 0;
      while ((bm = VERSE_ONLY_RE.exec(text)) !== null) {
        const from = bm.index;
        const to = from + bm[0].length;
        if (!overlaps(from, to)) {
          results.push({
            raw: bm[0],
            osisRef: `${book}.${chapter}.${parseInt(bm[1], 10)}`,
            from,
            to,
          });
          claim(from, to);
        }
      }
    }

    BARE_CHAPTER_VERSE_RE.lastIndex = 0;
    while ((bm = BARE_CHAPTER_VERSE_RE.exec(text)) !== null) {
      const from = bm.index;
      const to = from + bm[0].length;
      if (overlaps(from, to)) continue;

      const [, chStr, vStr, endChStr, endVStr] = bm;
      const chapterNum = parseInt(chStr, 10);
      const verseNum = parseInt(vStr, 10);
      let osisRef: string;
      if (endVStr === undefined) {
        osisRef = `${book}.${chapterNum}.${verseNum}`;
      } else {
        const endCh = endChStr !== undefined ? parseInt(endChStr, 10) : chapterNum;
        osisRef = `${book}.${chapterNum}.${verseNum}-${book}.${endCh}.${parseInt(endVStr, 10)}`;
      }

      results.push({ raw: bm[0], osisRef, from, to });
      claim(from, to);
    }

    results.sort((a, b) => a.from - b.from);
  }

  return results;
}
