/**
 * Parser for Bible text pasted from Bible.com, ESV apps, or USFM exports.
 *
 * Supports three body formats (auto-detected):
 *
 * 1. USFM format:
 *      \c 1\ms Book I\q1\v 1 Blessed\f + \fr 1:1 \ft ...\f* is the man...
 *    Detected by presence of \v N verse markers.
 *    Footnotes (\f...\f*) are stripped; \q1/\q2 poetry markers become line breaks;
 *    all other backslash markers are stripped.
 *
 * 2. Line-start format (ESV app, desktop apps, etc.):
 *      "1Blessed is the man\nwho walks not...\n2but his delight..."
 *    Verse numbers appear at the very start of a line with NO space before the text.
 *    Continuation lines (no leading digit) belong to the current verse.
 *    Line breaks within a verse are preserved using "\n".
 *
 * 3. Inline format (Bible.com):
 *      "1 In the beginning God created... 2 Now the earth was..."
 *    Verse numbers appear mid-paragraph, separated by spaces, before a capital letter.
 *
 * Formats 2 & 3 accept an optional header on the first line:
 *   "Genesis 1" | "Genesis 1:1-31" | "Genesis 1:1-31 (NIV)"
 */

export interface ParsedVerse {
  verse: number;
  text: string;
}

export interface ParseResult {
  verses: ParsedVerse[];
  detectedChapter: number | null;
  detectedBookName: string | null;
  detectedAbbreviation: string | null;
}

// Matches: "Genesis 1" or "Genesis 1:1-31" or "Genesis 1:1-31 (NIV)"
// Groups: [1] book name, [2] chapter, [3] abbreviation (optional)
const HEADER_RE = /^(.+?)\s+(\d+)(?::[\d\-]+)?\s*(?:\(([A-Z0-9\-]+)\))?\s*$/;

// Detects a line-start verse number: digits immediately followed by a non-digit (no space gap).
// e.g. "1Blessed", "12He said", but NOT "1 In" (that's the inline format).
const LINE_START_VERSE_RE = /^\d+\S/;

// Inline verse marker: digit sequence preceded by start-of-string or whitespace,
// followed by a space, followed by a capital letter or opening quote/bracket.
const VERSE_MARKER_RE = /(?:^|\s)(\d+) (?=[A-Z"'\u201C\u2018\[«])/g;

// USFM is detected by the presence of \v N verse markers.
const IS_USFM_RE = /\\v\s+\d+/;

export function parseBibleComText(raw: string): ParseResult {
  // USFM takes priority — detected before any other processing
  if (IS_USFM_RE.test(raw)) {
    return parseUSFM(raw);
  }

  const lines = raw.trim().split(/\r?\n/);

  let detectedChapter: number | null = null;
  let detectedBookName: string | null = null;
  let detectedAbbreviation: string | null = null;
  let bodyStartIndex = 0;

  const headerMatch = lines[0]?.trim().match(HEADER_RE);
  if (headerMatch) {
    detectedBookName = headerMatch[1].trim();
    detectedChapter = parseInt(headerMatch[2], 10);
    detectedAbbreviation = headerMatch[3] ?? null;
    bodyStartIndex = 1;
  }

  const bodyLines = lines.slice(bodyStartIndex).map((l) => l.trim());

  // Detect format: if any line starts with a digit immediately before a non-digit → line-start
  const isLineFormat = bodyLines.some((l) => LINE_START_VERSE_RE.test(l));

  const verses = isLineFormat
    ? extractVersesLineStart(bodyLines)
    : extractVersesInline(bodyLines);

  return { verses, detectedChapter, detectedBookName, detectedAbbreviation };
}

// ── USFM parser ───────────────────────────────────────────────────────────────

/**
 * Parses USFM-formatted Bible text.
 *
 * - Strips footnotes: \f + ... \f* and endnotes \fe + ... \fe*
 * - Converts poetry paragraph markers (\q, \q1, \q2, …) to line breaks
 * - Strips all remaining backslash markers
 * - Detects chapter from \c N and book name from \mt / \h markers
 */
function parseUSFM(raw: string): ParseResult {
  // Extract chapter number from \c N
  const chapterMatch = raw.match(/\\c\s+(\d+)/);
  const detectedChapter = chapterMatch ? parseInt(chapterMatch[1], 10) : null;

  // Extract book name from \mt, \mt1, or \h
  const bookMatch = raw.match(/\\(?:mt\d?|h)\s+([^\\\r\n]+)/);
  const detectedBookName = bookMatch ? bookMatch[1].trim() : null;

  // Strip footnotes (\f + ... \f*) and endnotes (\fe + ... \fe*)
  // The \+ is used inside footnote scope but we strip the whole block.
  let text = raw.replace(/\\fe?\s*\+[\s\S]*?\\fe?\*/g, "");

  // Flatten to a single line so all markers flow in sequence
  const flat = text.replace(/\r?\n/g, " ");

  // Find all \v N (or \v N-M range) markers and their positions
  const verseRe = /\\v\s+(\d+)(?:-\d+)?\s*/g;
  const verseStarts: { num: number; index: number; textStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = verseRe.exec(flat)) !== null) {
    verseStarts.push({
      num: parseInt(m[1], 10),
      index: m.index,
      textStart: m.index + m[0].length,
    });
  }

  if (verseStarts.length === 0) {
    return { verses: [], detectedChapter, detectedBookName, detectedAbbreviation: null };
  }

  const verses: ParsedVerse[] = [];
  for (let i = 0; i < verseStarts.length; i++) {
    const { num, textStart } = verseStarts[i];
    const end = verseStarts[i + 1]?.index ?? flat.length;
    let chunk = flat.slice(textStart, end);

    // Poetry/quote paragraph markers → line break (handles \q \q1 \q2 \q3 etc.)
    chunk = chunk.replace(/\\q\d*\s*/g, "\n");

    // Strip remaining closing inline markers: \word* (e.g. \wj* \nd*)
    chunk = chunk.replace(/\\[a-z]+\d*\*/g, "");

    // Strip remaining opening markers (optionally \+ prefixed): \word or \+word
    chunk = chunk.replace(/\\[+]?[a-z]+\d*\s*/g, "");

    // Normalise: trim each line, drop empties, rejoin with preserved breaks
    const cleaned = chunk
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join("\n");

    if (cleaned) verses.push({ verse: num, text: cleaned });
  }

  return { verses, detectedChapter, detectedBookName, detectedAbbreviation: null };
}

/** Line-start format: "1Blessed is the man\nwho walks..." */
function extractVersesLineStart(lines: string[]): ParsedVerse[] {
  const verses: ParsedVerse[] = [];
  let currentVerseNum: number | null = null;
  let currentLines: string[] = [];

  function flush() {
    if (currentVerseNum !== null && currentLines.length > 0) {
      verses.push({ verse: currentVerseNum, text: currentLines.join("\n") });
    }
  }

  for (const line of lines) {
    if (!line) continue; // skip blank lines between verses

    // Check if this line starts a new verse: leading digits immediately followed by text
    const m = line.match(/^(\d+)(.*)$/);
    if (m && LINE_START_VERSE_RE.test(line)) {
      flush();
      currentVerseNum = parseInt(m[1], 10);
      const rest = m[2].trim();
      currentLines = rest ? [rest] : [];
    } else {
      // Continuation line for the current verse
      if (currentVerseNum !== null) {
        currentLines.push(line);
      }
    }
  }
  flush();

  return verses;
}

/** Inline format: "1 In the beginning... 2 Now the earth was..." */
function extractVersesInline(lines: string[]): ParsedVerse[] {
  const body = lines.filter((l) => l.length > 0).join(" ");

  const matches: { markerStart: number; verseNum: number; textStart: number }[] = [];

  VERSE_MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VERSE_MARKER_RE.exec(body)) !== null) {
    const verseNum = parseInt(m[1], 10);
    const markerStart = m[0].startsWith(" ") ? m.index + 1 : m.index;
    const textStart = m.index + m[0].length;
    matches.push({ markerStart, verseNum, textStart });
  }

  if (matches.length === 0) {
    const text = body.trim();
    return text ? [{ verse: 1, text }] : [];
  }

  const verses: ParsedVerse[] = [];
  for (let i = 0; i < matches.length; i++) {
    const { verseNum, textStart } = matches[i];
    const end = matches[i + 1]?.markerStart ?? body.length;
    const text = body.slice(textStart, end).trim();
    if (text) {
      verses.push({ verse: verseNum, text });
    }
  }

  return verses;
}
