/**
 * Reconstructs a USFM book file from DB records.
 *
 * The output is designed to be a lossless round-trip of data stored in Structura:
 *  - Verse text (with preserved \nd / \add / \wj inline markers)
 *  - Footnotes and cross-references re-injected at their word_index positions
 *  - Paragraph breaks re-inserted as \p
 *  - Poetic indentation re-inserted as \q1 / \q2 / \q3
 *  - Section headings re-inserted as \s1 / \s2
 */

import type { TranslationVerse, TranslationFootnote } from "@/lib/db/schema";

export interface UsfmExportData {
  /** OSIS book code, e.g. "Gen" */
  book:       string;
  /** Human-readable book name for \h and \toc2 */
  bookName?:  string;
  /** Translation abbreviation for \id comment */
  abbr?:      string;

  verses:      TranslationVerse[];
  footnotes:   TranslationFootnote[];
  /** Set of osisRefs that start a new paragraph (\p) */
  paraBreaks:  Set<string>;
  /** osisRef → indent level (1–3) for \q1 / \q2 / \q3 */
  indents:     Map<string, number>;
  /** osisRef → { heading, level } */
  sections:    Map<string, { heading: string; level: number }>;
}

function injectFootnotes(
  verseText: string,
  notes: TranslationFootnote[],
): string {
  if (notes.length === 0) return verseText;

  // Split the verse text into words, inject footnote markers after word_index
  const words = verseText.split(/(\s+)/); // keep whitespace as tokens
  const actualWords: number[] = []; // indices into `words` that are actual words (not whitespace)
  for (let i = 0; i < words.length; i++) {
    if (words[i].trim()) actualWords.push(i);
  }

  // Build a map: wordIndex → footnote USFM strings
  const insertAfter = new Map<number, string[]>();
  for (const note of notes) {
    const key = Math.min(note.wordIndex, Math.max(0, actualWords.length - 1));
    if (!insertAfter.has(key)) insertAfter.set(key, []);
    const tag = note.type === "x" ? "x" : "f";
    insertAfter.get(key)!.push(`\\${tag} ${note.content} \\${tag}*`);
  }

  // Reconstruct: after each actual word at position key, append footnote markers
  let result = "";
  let wordPos = 0;
  for (let i = 0; i < words.length; i++) {
    result += words[i];
    if (words[i].trim()) {
      const markers = insertAfter.get(wordPos);
      if (markers) result += markers.join(" ");
      wordPos++;
    }
  }
  return result;
}

export function exportToUsfm(data: UsfmExportData): string {
  const { book, bookName, abbr, verses, footnotes, paraBreaks, indents, sections } = data;

  // Group footnotes by osisRef for quick lookup
  const footnotesByRef = new Map<string, TranslationFootnote[]>();
  for (const fn of footnotes) {
    const list = footnotesByRef.get(fn.osisRef) ?? [];
    list.push(fn);
    footnotesByRef.set(fn.osisRef, list);
  }

  // Sort by chapter then verse
  const sorted = [...verses].sort((a, b) =>
    a.chapter !== b.chapter ? a.chapter - b.chapter : a.verse - b.verse
  );

  const lines: string[] = [];
  let currentChapter = 0;

  // File header
  const idComment = abbr ? `${book} - ${abbr}` : book;
  lines.push(`\\id ${book.toUpperCase()} ${idComment}`);
  if (bookName) {
    lines.push(`\\h ${bookName}`);
    lines.push(`\\toc1 ${bookName}`);
    lines.push(`\\toc2 ${bookName}`);
    lines.push(`\\mt ${bookName}`);
  }

  for (const verse of sorted) {
    // Chapter heading
    if (verse.chapter !== currentChapter) {
      currentChapter = verse.chapter;
      lines.push("");
      lines.push(`\\c ${currentChapter}`);
      lines.push("\\p");
    }

    // Section heading before this verse
    const section = sections.get(verse.osisRef);
    if (section) {
      const sMarker = section.level === 1 ? "ms1"
        : section.level === 2 ? "ms2"
        : section.level === 3 ? "s1"
        : section.level === 4 ? "s2"
        : section.level === 5 ? "s3"
        : "s4";
      lines.push(`\\${sMarker} ${section.heading}`);
    }

    // Paragraph / poetry indent before this verse
    const isParaBreak = paraBreaks.has(verse.osisRef);
    const indentLevel = indents.get(verse.osisRef);

    if (isParaBreak && !indentLevel) {
      lines.push("\\p");
    } else if (indentLevel) {
      lines.push(`\\q${indentLevel}`);
    }

    // Inject footnotes into verse text
    const notes = footnotesByRef.get(verse.osisRef) ?? [];
    const verseBody = injectFootnotes(verse.text, notes);

    lines.push(`\\v ${verse.verse} ${verseBody}`);
  }

  lines.push("");
  return lines.join("\n");
}
