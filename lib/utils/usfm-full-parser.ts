/**
 * Full USFM book-file parser.
 *
 * Handles a complete USFM file (one or more books) and extracts:
 *  - verses (text with \nd / \add / \wj inline markers preserved)
 *  - footnotes (\f) and cross-references (\x) as separate records
 *  - paragraph breaks (\p, \m)
 *  - poetic indentation (\q1, \q2, \q3)
 *  - section headings (\s1, \s2)
 *  - a per-file marker inventory (preserved vs stripped) for the pre-import UI
 */

export const PARATEXT_TO_OSIS: Record<string, string> = {
  GEN: "Gen",   EXO: "Exod",  LEV: "Lev",   NUM: "Num",   DEU: "Deut",
  JOS: "Josh",  JDG: "Judg",  RUT: "Ruth",  "1SA": "1Sam", "2SA": "2Sam",
  "1KI": "1Kgs","2KI": "2Kgs","1CH": "1Chr","2CH": "2Chr", EZR: "Ezra",
  NEH: "Neh",   EST: "Esth",  JOB: "Job",   PSA: "Ps",    PRO: "Prov",
  ECC: "Eccl",  SNG: "Song",  ISA: "Isa",   JER: "Jer",   LAM: "Lam",
  EZK: "Ezek",  DAN: "Dan",   HOS: "Hos",   JOL: "Joel",  AMO: "Amos",
  OBA: "Obad",  JON: "Jonah", MIC: "Mic",   NAM: "Nah",   HAB: "Hab",
  ZEP: "Zeph",  HAG: "Hag",   ZEC: "Zech",  MAL: "Mal",
  MAT: "Matt",  MRK: "Mark",  LUK: "Luke",  JHN: "John",  ACT: "Acts",
  ROM: "Rom",   "1CO": "1Cor","2CO": "2Cor", GAL: "Gal",   EPH: "Eph",
  PHP: "Phil",  COL: "Col",   "1TH": "1Thess","2TH": "2Thess",
  "1TI": "1Tim","2TI": "2Tim", TIT: "Titus", PHM: "Phlm",  HEB: "Heb",
  JAS: "Jas",   "1PE": "1Pet","2PE": "2Pet", "1JN": "1John","2JN": "2John",
  "3JN": "3John",JUD: "Jude", REV: "Rev",
};

// Markers whose content is preserved inline (rendered as styled spans)
const PRESERVED_INLINE = new Set(["nd", "add", "wj", "qt", "it", "qs", "bd"]);

// Paragraph-type markers that start a new paragraph before the next verse
const PARA_MARKERS = new Set(["p", "m", "b", "nb", "pi", "pc", "ph"]);

export interface ParsedVerseRecord {
  osisRef:  string;
  book:     string;
  chapter:  number;
  verse:    number;
  text:     string;
}

export interface ParsedFootnoteRecord {
  osisRef:   string;
  book:      string;
  chapter:   number;
  verse:     number;
  type:      "f" | "x";
  content:   string;
  wordIndex: number;
}

export interface ParsedParagraphBreak {
  osisRef: string;
}

export interface ParsedLineIndent {
  osisRef: string;
  level:   number;
}

export interface ParsedSectionBreak {
  osisRef:  string;
  heading:  string;
  level:    number;
}

export interface UsfmMarkerInventory {
  /** Markers whose content is kept (inline or as structured records). */
  preserved: string[];
  /** Markers that will be stripped entirely. */
  stripped:  string[];
}

export interface ParsedUsfmFile {
  detectedBook:    string | null;  // OSIS code, e.g. "Gen"
  paratextCode:    string | null;
  verses:          ParsedVerseRecord[];
  footnotes:       ParsedFootnoteRecord[];
  paragraphBreaks: ParsedParagraphBreak[];
  lineIndents:     ParsedLineIndent[];
  sectionBreaks:   ParsedSectionBreak[];
  markerInventory: UsfmMarkerInventory;
  stats: {
    chapters: number;
    verses:   number;
  };
}

// ── Tokenizer ─────────────────────────────────────────────────────────────────

interface Token {
  marker:  string;   // e.g. "v", "nd", "f"
  closing: boolean;  // true for \nd* \f* etc.
  text:    string;   // text following this token up to the next \marker
}

function tokenize(usfm: string): Token[] {
  // Flatten line-endings to spaces so markers and text flow in one stream.
  const flat = usfm.replace(/\r?\n/g, " ");

  // Regex matches \marker or \marker* optionally followed by whitespace.
  // Group 1 = marker name, Group 2 = "*" if closing.
  const RE = /\\([a-z]+(?:\+?[a-z]*\d*))(\*)?[ \t]*/gi;

  const tokens: Token[] = [];
  let lastEnd = 0;
  let m: RegExpExecArray | null;

  // Collect all marker positions
  const matches: Array<{ marker: string; closing: boolean; idx: number; end: number }> = [];
  while ((m = RE.exec(flat)) !== null) {
    matches.push({
      marker:  m[1].toLowerCase(),
      closing: m[2] === "*",
      idx:     m.index,
      end:     m.index + m[0].length,
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const nextIdx = matches[i + 1]?.idx ?? flat.length;
    tokens.push({
      marker:  cur.marker,
      closing: cur.closing,
      text:    flat.slice(cur.end, nextIdx),
    });
  }

  void lastEnd;
  return tokens;
}

// ── Footnote content cleaner ──────────────────────────────────────────────────

/** Strip USFM sub-markers and auto-caller from stored footnote content. */
function cleanFootnoteContent(raw: string): string {
  return raw
    .replace(/^[+\-a-z]\s+/i, "")       // strip leading auto-caller (+ or -)
    .replace(/\\f[a-z]*\s*/g, "")        // strip \ft \fq \fk \fqa \fv \fl etc.
    .replace(/\\[a-z]+\d*\*?\s*/g, "")  // strip any remaining markers
    .replace(/\s+/g, " ")
    .trim();
}

// ── Main parser ───────────────────────────────────────────────────────────────

export function parseUsfmFile(raw: string): ParsedUsfmFile {
  const tokens = tokenize(raw);

  let paratextCode:     string | null = null;
  let osisBook:         string | null = null;
  let currentChapter    = 0;
  let currentVerse      = 0;

  // Accumulated verse text (with preserved markers inline)
  let verseText         = "";
  // Word count so far in the current verse (for footnote word_index)
  let wordsSoFar        = 0;

  // State flags
  let inFootnote        = false;
  let footnoteType: "f" | "x" = "f";
  let footnoteContent   = "";

  let pendingParaBreak  = false;
  let pendingIndent:    number | null = null;
  let pendingSection:   { heading: string; level: number } | null = null;

  // Outputs
  const verses:          ParsedVerseRecord[]    = [];
  const footnotes:       ParsedFootnoteRecord[] = [];
  const paragraphBreaks: ParsedParagraphBreak[] = [];
  const lineIndents:     ParsedLineIndent[]     = [];
  const sectionBreaks:   ParsedSectionBreak[]   = [];

  // Marker inventory
  const preservedSeen = new Set<string>();
  const strippedSeen  = new Set<string>();

  // Structural markers that are intentionally handled (not "stripped")
  const HANDLED_STRUCTURAL = new Set([
    "id", "h", "mt", "mt1", "mt2", "toc1", "toc2", "toc3",
    "c", "v",
    "p", "m", "b", "nb", "pi", "pc", "ph",
    "q", "q1", "q2", "q3", "q4", "qc", "qr", "qm", "qm1", "qm2",
    "s", "s1", "s2", "s3", "s4", "ms", "ms1", "mr", "sr",
    "f", "fe", "x", "ft", "xt", "fq", "fqa", "fk", "fl", "fp", "fv", "fdc",
    "xo", "xk", "xq", "xt", "xdc", "xop", "xot", "xnt", "xta",
    "nd", "add", "wj", "qt", "it", "qs", "bd",
    // common ignored wrappers
    "rem", "sts", "restore", "cl", "cp", "cd",
    "r", "d", "sp", "rq",
    "li", "li1", "li2", "li3",
    "pmo", "pm", "pmc", "pmr",
    "mi", "nb",
    "w",        // USFM 3 word
    "zaln",     // alignment
  ]);

  function flushVerse() {
    if (!osisBook || currentChapter === 0 || currentVerse === 0) return;
    const text = verseText.replace(/\s+/g, " ").trim();
    if (!text) return;
    const osisRef = `${osisBook}.${currentChapter}.${currentVerse}`;
    verses.push({ osisRef, book: osisBook, chapter: currentChapter, verse: currentVerse, text });
    verseText = "";
    wordsSoFar = 0;
  }

  function applyPending(osisRef: string) {
    if (pendingParaBreak) {
      paragraphBreaks.push({ osisRef });
      pendingParaBreak = false;
    }
    if (pendingIndent !== null) {
      lineIndents.push({ osisRef, level: pendingIndent });
      pendingIndent = null;
    }
    if (pendingSection) {
      sectionBreaks.push({ osisRef, ...pendingSection });
      pendingSection = null;
    }
  }

  function countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  for (const tok of tokens) {
    const { marker, closing, text } = tok;

    // ── Inside a footnote / cross-ref ──────────────────────────────────────
    if (inFootnote) {
      if ((marker === "f" || marker === "fe") && closing) {
        // \f* — end footnote
        if (osisBook && currentChapter && currentVerse) {
          footnotes.push({
            osisRef:   `${osisBook}.${currentChapter}.${currentVerse}`,
            book:      osisBook,
            chapter:   currentChapter,
            verse:     currentVerse,
            type:      footnoteType,
            content:   cleanFootnoteContent(footnoteContent),
            wordIndex: wordsSoFar,
          });
        }
        inFootnote = false;
        footnoteContent = "";
        // The tokenizer strips the space after \f*, so restore it before the next word
        if (text.length > 0) {
          if (verseText.length > 0 && !verseText.endsWith(" ")) verseText += " ";
          verseText += text;
          wordsSoFar += countWords(text);
        }
      } else if (marker === "x" && closing) {
        // \x*
        if (osisBook && currentChapter && currentVerse) {
          footnotes.push({
            osisRef:   `${osisBook}.${currentChapter}.${currentVerse}`,
            book:      osisBook,
            chapter:   currentChapter,
            verse:     currentVerse,
            type:      "x",
            content:   cleanFootnoteContent(footnoteContent),
            wordIndex: wordsSoFar,
          });
        }
        inFootnote = false;
        footnoteContent = "";
        if (text.length > 0) {
          if (verseText.length > 0 && !verseText.endsWith(" ")) verseText += " ";
          verseText += text;
          wordsSoFar += countWords(text);
        }
      } else {
        // Accumulate all sub-markers and text as raw footnote content
        const raw = closing ? `\\${marker}* ${text}` : `\\${marker} ${text}`;
        footnoteContent += raw;
      }
      continue;
    }

    // ── Book / structure markers ───────────────────────────────────────────
    if (marker === "id") {
      const code = text.trim().split(/\s/)[0].toUpperCase();
      paratextCode = code;
      osisBook = PARATEXT_TO_OSIS[code] ?? null;
      continue;
    }

    if (marker === "c") {
      flushVerse();
      currentChapter = parseInt(text.trim().split(/\s/)[0], 10) || 0;
      currentVerse   = 0;
      continue;
    }

    if (marker === "v") {
      flushVerse();
      const parts = text.trim().split(/\s+/);
      // Handle verse ranges like "1-2"
      currentVerse = parseInt(parts[0].split("-")[0], 10) || 0;
      const rest   = parts.slice(1).join(" ");

      const osisRef = `${osisBook}.${currentChapter}.${currentVerse}`;
      applyPending(osisRef);

      verseText   = rest;
      wordsSoFar  = countWords(rest);
      continue;
    }

    // ── Paragraph / poetry markers ─────────────────────────────────────────
    if (PARA_MARKERS.has(marker) && !closing) {
      pendingParaBreak = true;
      // text after \p may be empty or inline text
      if (text.trim()) {
        verseText += text;
        wordsSoFar += countWords(text);
      }
      continue;
    }

    if ((marker === "q" || marker.startsWith("q")) && !closing) {
      const lvl = parseInt(marker.slice(1) || "1", 10) || 1;
      pendingIndent = lvl;
      if (text.trim()) {
        verseText += text;
        wordsSoFar += countWords(text);
      }
      continue;
    }

    // ── Section headings ──────────────────────────────────────────────────
    if ((marker === "s" || marker === "s1" || marker === "s2" || marker === "s3" || marker === "s4" || marker === "ms" || marker === "ms1" || marker === "ms2") && !closing) {
      const level = marker === "ms1" || marker === "ms" ? 1
        : marker === "ms2" ? 2
        : marker === "s" || marker === "s1" ? 3
        : marker === "s2" ? 4
        : marker === "s3" ? 5
        : 6; // s4
      pendingSection = { heading: text.trim(), level };
      continue;
    }

    // ── Footnote / cross-reference start ─────────────────────────────────
    if ((marker === "f" || marker === "fe") && !closing) {
      inFootnote    = true;
      footnoteType  = "f";
      footnoteContent = text; // text after \f (usually "+ " then \ft)
      preservedSeen.add(marker);
      // Insert a positional superscript placeholder in the verse text
      if (verseText.length > 0 && !verseText.endsWith(" ")) verseText += " ";
      verseText += "\\fn \\fn*";
      continue;
    }
    if (marker === "x" && !closing) {
      inFootnote    = true;
      footnoteType  = "x";
      footnoteContent = text;
      preservedSeen.add("x");
      if (verseText.length > 0 && !verseText.endsWith(" ")) verseText += " ";
      verseText += "\\fn \\fn*";
      continue;
    }

    // ── Preserved inline markers ──────────────────────────────────────────
    if (PRESERVED_INLINE.has(marker)) {
      preservedSeen.add(marker);
      if (closing) {
        verseText += `\\${marker}* `;
      } else {
        verseText += `\\${marker} `;
        if (text) {
          verseText += text;
          wordsSoFar += countWords(text);
        }
      }
      continue;
    }

    // ── USFM 3 word marker \w word|attrs\w* ──────────────────────────────
    if (marker === "w" && !closing) {
      // Extract just the word (before |)
      const word = text.split("|")[0].trim();
      verseText  += word + " ";
      wordsSoFar += 1;
      continue;
    }

    // ── Markers to skip silently (structural, metadata) ───────────────────
    if (HANDLED_STRUCTURAL.has(marker)) {
      // Marker is known but produces no output — its following text may still
      // be inline content (e.g. \add text\add* but handled above).
      // For purely structural markers, ignore text too.
      continue;
    }

    // ── Everything else: strip marker, optionally keep text ───────────────
    strippedSeen.add(marker);
    // If it's a closing marker, no text to preserve. If opening, the inline
    // text (before the next marker) belongs in the verse.
    if (!closing && text.trim() && currentVerse > 0) {
      verseText  += text;
      wordsSoFar += countWords(text);
    }
  }

  flushVerse();

  // Deduplicate: remove from strippedSeen anything that's actually handled
  for (const m of [...HANDLED_STRUCTURAL, ...PRESERVED_INLINE]) {
    strippedSeen.delete(m as string);
  }

  // Build marker inventory
  const KNOWN_PRESERVED = ["nd", "add", "wj", "qt", "it", "qs", "bd", "f", "x", "p", "m", "q1", "q2", "q3", "s1", "s2"];
  for (const m of KNOWN_PRESERVED) preservedSeen.add(m);

  const markerInventory: UsfmMarkerInventory = {
    preserved: [...preservedSeen].sort(),
    stripped:  [...strippedSeen].sort(),
  };

  const chapters = new Set(verses.map(v => v.chapter)).size;

  return {
    detectedBook:    osisBook,
    paratextCode,
    verses,
    footnotes,
    paragraphBreaks,
    lineIndents,
    sectionBreaks,
    markerInventory,
    stats: { chapters, verses: verses.length },
  };
}
