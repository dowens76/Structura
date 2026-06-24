import type { Word } from "@/lib/db/source-schema";
import { OSIS_BOOK_NAMES } from "@/lib/utils/osis";

export type TranslitExportFormat = "interlinear" | "running";

export interface TranslitExportOpts {
  format: TranslitExportFormat;
  startVerse: number;
  endVerse: number;
  book: string;
  chapter: number;
}

/** Strip all HTML tags, leaving only inner text. */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/** Human-readable book name for the reference label. */
function bookLabel(osisCode: string): string {
  return (OSIS_BOOK_NAMES as Record<string, string>)[osisCode] ?? osisCode;
}

/**
 * Build clipboard content (HTML + plain text) for a range of transliterated words.
 *
 * - HTML version: pastes as rich text into Word / LibreOffice with bold/italic preserved.
 * - Plain text version: readable fallback; transliteration chars are Unicode so they survive.
 *
 * `formatMap` values are sanitized HTML using only <b> and <i> tags.
 * When a word has no entry in formatMap, falls back to word.transliteration.
 */
export function buildTransliterationClipboard(
  words: Word[],
  formatMap: Map<string, string>,
  opts: TranslitExportOpts,
): { html: string; plain: string } {
  const { format, startVerse, endVerse, book, chapter } = opts;
  const bookName = bookLabel(book);

  // Filter to the requested verse range and exclude words without transliteration
  const inRange = words.filter(
    (w) => w.verse >= startVerse && w.verse <= endVerse && w.transliteration,
  );

  // Group by verse (preserving order)
  const byVerse = new Map<number, Word[]>();
  for (const w of inRange) {
    if (!byVerse.has(w.verse)) byVerse.set(w.verse, []);
    byVerse.get(w.verse)!.push(w);
  }

  if (byVerse.size === 0) return { html: "", plain: "" };

  const isHebrew = inRange[0]?.language === "hebrew";

  if (format === "running") {
    return buildRunning(byVerse, formatMap, bookName, chapter, isHebrew);
  } else {
    return buildInterlinear(byVerse, formatMap, bookName, chapter, isHebrew);
  }
}

// ── Running transliteration ───────────────────────────────────────────────────

function buildRunning(
  byVerse: Map<number, Word[]>,
  formatMap: Map<string, string>,
  bookName: string,
  chapter: number,
  isHebrew: boolean,
): { html: string; plain: string } {
  const htmlParts: string[] = [];
  const plainParts: string[] = [];

  for (const [verse, words] of byVerse) {
    const ref = `${bookName} ${chapter}:${verse}`;

    const wordHtmlParts = words.map((w) => {
      const fmt = formatMap.get(w.wordId);
      return fmt ?? (w.transliteration ?? "");
    });
    const wordPlainParts = words.map((w) => {
      const fmt = formatMap.get(w.wordId);
      return fmt ? stripTags(fmt) : (w.transliteration ?? "");
    });

    // Hebrew is RTL but transliteration is always LTR
    const line = wordHtmlParts.join(" ");
    const plainLine = wordPlainParts.join(" ");

    htmlParts.push(
      `<p style="margin: 4px 0; font-family: serif;"><b>${ref}</b> ${line}</p>`,
    );
    plainParts.push(`${ref} ${plainLine}`);
  }

  const html = `<div>${htmlParts.join("\n")}</div>`;
  const plain = plainParts.join("\n");
  return { html, plain };
}

// ── Interlinear table ─────────────────────────────────────────────────────────

function buildInterlinear(
  byVerse: Map<number, Word[]>,
  formatMap: Map<string, string>,
  bookName: string,
  chapter: number,
  isHebrew: boolean,
): { html: string; plain: string } {
  const tableParts: string[] = [];
  const plainParts: string[] = [];

  const srcFont  = isHebrew
    ? `font-family: 'SBL Hebrew', 'Ezra SIL', serif; font-size: 14pt; direction: rtl;`
    : `font-family: 'SBL Greek', 'Gentium Plus', serif; font-size: 13pt;`;
  const cellBase = `padding: 4px 6px; border: 1px solid #ccc; vertical-align: top;`;

  for (const [verse, words] of byVerse) {
    const ref = `${bookName} ${chapter}:${verse}`;
    const colSpan = words.length + 1; // +1 for the reference column

    // Header row: reference spanning all columns
    const headerRow = `<tr><td colspan="${colSpan}" style="${cellBase} font-weight: bold; background: #f5f5f5;">${ref}</td></tr>`;

    // Source text row (Hebrew/Greek)
    const srcCells = [
      `<td style="${cellBase} color: #666; font-size: 9pt; white-space: nowrap;"></td>`, // empty ref cell
      ...words.map((w) => {
        const surface = w.surfaceText.replace(/\//g, ""); // strip morpheme slashes
        return `<td style="${cellBase} ${srcFont} white-space: nowrap;">${surface}</td>`;
      }),
    ];
    const srcRow = `<tr>${srcCells.join("")}</tr>`;

    // Transliteration row
    const translitCells = [
      `<td style="${cellBase} color: #666; font-size: 9pt; white-space: nowrap;"></td>`,
      ...words.map((w) => {
        const fmt = formatMap.get(w.wordId);
        const content = fmt ?? (w.transliteration ?? "");
        return `<td style="${cellBase} font-family: serif; white-space: nowrap;">${content}</td>`;
      }),
    ];
    const translitRow = `<tr>${translitCells.join("")}</tr>`;

    tableParts.push(
      `<table style="border-collapse: collapse; margin-bottom: 8px;">${headerRow}${srcRow}${translitRow}</table>`,
    );

    // Plain text: two lines per verse
    const srcLine = words.map((w) => w.surfaceText.replace(/\//g, "")).join("  ");
    const trLine  = words.map((w) => {
      const fmt = formatMap.get(w.wordId);
      return fmt ? stripTags(fmt) : (w.transliteration ?? "");
    }).join("  ");
    plainParts.push(`${ref}\n${srcLine}\n${trLine}`);
  }

  const html  = `<div>${tableParts.join("\n")}</div>`;
  const plain = plainParts.join("\n\n");
  return { html, plain };
}
