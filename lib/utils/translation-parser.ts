/**
 * Parser for Bible text pasted from Bible.com, ESV apps, or USFM exports.
 *
 * Processing pipeline:
 *
 * 1. If the raw text already contains USFM \v N markers → parseUSFM() directly.
 *
 * 2. Otherwise, strip the optional header line ("Genesis 1", "Genesis 1:1-31 (NIV)"),
 *    then call injectVerseMarkers() which converts plain verse numbers — both
 *    line-start ("1 Blessed…") and inline ("… 2 Now the earth…") — into \v N
 *    markers, producing USFM-like text.  parseUSFM() then handles verse splitting.
 *
 * 3. If no verse numbers were found at all, the entire body is returned as verse 1.
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

  const body = lines
    .slice(bodyStartIndex)
    .map((l) => l.trim())
    .join("\n");

  // Inject \v markers before verse numbers (line-start and inline), then
  // route through the USFM parser which handles verse splitting reliably.
  const withMarkers = injectVerseMarkers(body);

  if (IS_USFM_RE.test(withMarkers)) {
    const result = parseUSFM(withMarkers);
    return {
      verses: result.verses,
      detectedChapter: result.detectedChapter ?? detectedChapter,
      detectedBookName: result.detectedBookName ?? detectedBookName,
      detectedAbbreviation: result.detectedAbbreviation ?? detectedAbbreviation,
    };
  }

  // No verse numbers detected — return the whole body as verse 1
  const text = body.trim();
  const verses = text ? [{ verse: 1, text }] : [];
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

/**
 * Convert plain verse numbers in non-USFM text into \v N markers so the USFM
 * parser can handle verse splitting reliably.
 *
 * Three passes are applied:
 *
 *  1. Standalone verse-number lines: a line that is purely 1–3 digits is merged
 *     with the next non-empty line (skipping blank lines between them).
 *     If no following content line exists the number becomes a bare \v marker.
 *       "1\n\nIn the beginning…"  →  "1 In the beginning…"  →  "\v 1 In the beginning…"
 *
 *  2. Line-start injection: after normalising "1Letter" → "1 Letter", a line
 *     beginning with 1–3 digits followed by any non-whitespace is converted.
 *       "1 Blessed is the man"  →  "\v 1 Blessed is the man"
 *       "2"In the beginning"    →  "\v 2 "In the beginning"
 *
 *  3. Inline injection: digits preceded by a non-newline space and followed by
 *     a space + non-digit/non-whitespace character.
 *       "…void 2 Now the Spirit…"  →  "…void \v 2 Now the Spirit…"
 *
 * The 1–3 digit limit keeps large inline numbers ("130 years", "1000 shekels")
 * from being misidentified as verse markers.
 */
function injectVerseMarkers(body: string): string {
  const lines = body.split(/\r?\n/);

  // Pass 1: merge standalone verse-number lines with the following non-empty line,
  // skipping any blank lines in between. "1Letter" → "1 Letter" normalisation.
  const merged: string[] = [];
  let i = 0;
  while (i < lines.length) {
    let line = lines[i].trim();
    if (/^\d{1,3}$/.test(line)) {
      // Find next non-empty line (skip blank lines between number and text)
      let j = i + 1;
      while (j < lines.length && lines[j].trim().length === 0) j++;
      if (j < lines.length) {
        line = line + " " + lines[j].trim();
        i = j + 1;
      } else {
        // Standalone number at end of input: convert directly to a \v marker
        line = `\\v ${line} `;
        i++;
      }
    } else {
      i++;
    }
    // "1Letter" → "1 Letter" (only at line start, handles adjacent digits+letters)
    line = line.replace(/^(\d{1,3})([^\s\d\\])/, "$1 $2");
    if (line) merged.push(line);
  }

  // Pass 2: inject \v before line-start verse numbers.
  //   Lookahead requires any non-whitespace character so Unicode text, quotes,
  //   brackets and other non-ASCII letters are all matched correctly.
  //   "1 Blessed…"  →  "\v 1 Blessed…"
  const withLineStart = merged
    .map((line) => line.replace(/^(\d{1,3})\s+(?=\S)/, "\\v $1 "))
    .join("\n");

  // Pass 3: inject \v before inline verse numbers (mid-paragraph).
  //   Lookahead accepts any non-digit, non-whitespace character so Unicode
  //   letters and opening punctuation all qualify.
  //   The space between the number and the text is optional so both
  //   "…void 2 Now…" and "…void 2Now…" are handled.
  //   "…void 2 Now…"  →  "…void \v 2 Now…"
  //   "…void 2Now…"   →  "…void \v 2 Now…"
  const withInline = withLineStart.replace(
    /([^\S\r\n])(\d{1,3}) ?(?=[^\d\s])/g,
    "$1\\v $2 "
  );

  return withInline;
}
