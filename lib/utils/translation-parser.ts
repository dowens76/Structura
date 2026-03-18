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
 * 2. Line-start format (ESV app, desktop apps, Bible.com, etc.):
 *      "1Blessed is the man\nwho walks not...\n2but his delight..."  (no space)
 *      "1 Blessed is the man\n2 but his delight..."                  (with space)
 *      Mixed no-space / with-space lines in the same paste are also handled.
 *    Detected when any line starts with digits immediately followed by non-whitespace.
 *    Continuation lines (no leading digit) belong to the current verse.
 *    Line breaks within a verse are preserved using "\n".
 *
 * 3. Inline format (Bible.com):
 *      "1 In the beginning God created... 2 Now the earth was..."
 *    Verse numbers (1-3 digits) appear mid-paragraph, separated by spaces, before any letter or quote.
 *    Lowercase verse starts are supported (e.g. "6 for the LORD…").
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

// Inline verse marker: 1-3 digit number preceded by start-of-string or whitespace,
// followed by a space and any letter or opening quote/bracket.
// Allows lowercase (e.g. "6 for the LORD") — many translations start verses lowercase.
// Limited to 3 digits to reduce false matches on large inline numbers like "1000 shekels".
const VERSE_MARKER_RE = /(?:^|\s)(\d{1,3}) (?=[A-Za-z"'\u201C\u2018\[«])/g;

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

  let verses = isLineFormat
    ? extractVersesLineStart(bodyLines)
    : extractVersesInline(bodyLines);

  // If line-start format was (mis-)detected but produced nothing, retry with inline
  if (verses.length === 0 && isLineFormat) {
    verses = extractVersesInline(bodyLines);
  }

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

/** Line-start format: "1Blessed is the man\nwho walks..." or "1 Blessed is the man\n..." */
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

    // Accept both "1Blessed" (no space) and "1 Blessed" (with space) as verse starters.
    // A monotonically-increasing verse number check prevents continuation lines that
    // happen to start with a number (e.g. "2nd Chronicles…" or "15 cubits deep")
    // from being misidentified as new verses.
    const m = line.match(/^(\d{1,3})\s*(.+)/);
    if (m) {
      const potentialNum = parseInt(m[1], 10);
      if (potentialNum >= 1 && potentialNum <= 200 && potentialNum > (currentVerseNum ?? 0)) {
        flush();
        currentVerseNum = potentialNum;
        currentLines = [m[2].trim()];
        continue;
      }
    }

    // Continuation line for the current verse
    if (currentVerseNum !== null) {
      currentLines.push(line);
    }
  }
  flush();

  return verses;
}

/** Inline format: "1 In the beginning... 2 Now the earth was..." */
function extractVersesInline(lines: string[]): ParsedVerse[] {
  // Pre-process lines before joining:
  // 1. Merge standalone verse-number lines with the following line.
  //    Some apps place the verse number alone on its own line:
  //      ["1", "In the beginning..."]  →  ["1 In the beginning..."]
  // 2. Insert a space after a leading verse number that is immediately followed by text
  //    (no space), so the VERSE_MARKER_RE can find it after joining:
  //      "1In the beginning..." → "1 In the beginning..."
  const processedLines: string[] = [];
  let i = 0;
  while (i < lines.length) {
    let line = lines[i].trim();

    // Merge: standalone verse-number line + next line
    if (/^\d{1,3}$/.test(line) && i + 1 < lines.length && lines[i + 1].trim().length > 0) {
      line = line + " " + lines[i + 1].trim();
      i += 2;
    } else {
      i++;
    }

    // Normalize: "1In the beginning" → "1 In the beginning"
    line = line.replace(/^(\d{1,3})([A-Za-z"'\u201C\u2018\[«])/, "$1 $2");

    processedLines.push(line);
  }

  // Join with newlines so that any line breaks that existed within a verse (e.g. poetic
  // half-lines, indented continuations) survive as "\n" in the stored verse text.
  // VERSE_MARKER_RE treats "\n" as whitespace, so verse boundary detection is unaffected.
  const body = processedLines.filter((l) => l.trim().length > 0).join("\n");

  const allMatches: { markerStart: number; verseNum: number; textStart: number }[] = [];

  VERSE_MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VERSE_MARKER_RE.exec(body)) !== null) {
    const verseNum = parseInt(m[1], 10);
    if (verseNum < 1 || verseNum > 200) continue; // skip implausible verse numbers
    // m[0] may start with the preceding whitespace char (space OR newline); skip it for markerStart
    const markerStart = /^\s/.test(m[0]) ? m.index + 1 : m.index;
    const textStart = m.index + m[0].length;
    allMatches.push({ markerStart, verseNum, textStart });
  }

  // Pick the best monotonically-increasing sequence.
  // This rejects false positives from section headings, genealogy numbers, copyright years, etc.
  const matches = pickBestVerseSequence(allMatches);

  if (matches.length === 0) {
    const text = body.trim();
    return text ? [{ verse: 1, text }] : [];
  }

  const verses: ParsedVerse[] = [];
  for (let j = 0; j < matches.length; j++) {
    const { verseNum, textStart } = matches[j];
    const end = matches[j + 1]?.markerStart ?? body.length;
    const text = body.slice(textStart, end).trim();
    if (text) {
      verses.push({ verse: verseNum, text });
    }
  }

  return verses;
}

/**
 * From a list of potential verse-number matches (in text order), select the best
 * monotonically-increasing sequence.
 *
 * - Anchors at the first occurrence of verse 1 when present, skipping any false
 *   positives (section heading numbers, etc.) that appear before it.
 * - Only accepts a match if the verse number is strictly greater than the previous
 *   AND does not jump by more than MAX_VERSE_GAP — this rejects large inline numbers
 *   like "130" appearing in the middle of a verse's text (e.g. "lived 130 years").
 */
function pickBestVerseSequence<T extends { verseNum: number }>(matches: T[]): T[] {
  // Allow jumps up to 25 (handles partial-chapter imports while blocking large inline numbers).
  const MAX_VERSE_GAP = 25;
  if (matches.length === 0) return [];

  // Prefer starting at verse 1 if present; otherwise start at the first match.
  const verse1Idx = matches.findIndex((m) => m.verseNum === 1);
  const startIdx = verse1Idx >= 0 ? verse1Idx : 0;

  const result: T[] = [];
  let last = 0;
  for (let i = startIdx; i < matches.length; i++) {
    const { verseNum } = matches[i];
    const isFirst = last === 0;
    if (verseNum > last && (isFirst || verseNum - last <= MAX_VERSE_GAP)) {
      result.push(matches[i]);
      last = verseNum;
    }
  }
  return result;
}
