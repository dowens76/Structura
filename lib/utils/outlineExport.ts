/**
 * Generates a classical hierarchical outline from section breaks.
 *
 * Level prefixes:
 *   Level 1: I. II. III. …  (Roman numerals)
 *   Level 2: A. B. C. …     (uppercase letters)
 *   Level 3: 1. 2. 3. …     (arabic numbers)
 *   Level 4: a. b. c. …     (lowercase letters)
 *   Level 5: (1) (2) (3) …  (parenthesised numbers)
 *   Level 6: (a) (b) (c) … (parenthesised lowercase letters)
 *
 * Counters reset when a higher-level (lower number) break is encountered.
 */

// Roman numeral conversion (up to 100)
function toRoman(n: number): string {
  const vals = [100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = ["C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"];
  let result = "";
  for (let i = 0; i < vals.length; i++) {
    while (n >= vals[i]) {
      result += syms[i];
      n -= vals[i];
    }
  }
  return result;
}

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function formatPrefix(level: number, counter: number): string {
  switch (level) {
    case 1: return toRoman(counter) + ". ";
    case 2: return (UPPER[counter - 1] ?? String(counter)) + ". ";
    case 3: return String(counter) + ". ";
    case 4: return (LOWER[counter - 1] ?? String(counter)) + ". ";
    case 5: return "(" + String(counter) + ") ";
    case 6: return "(" + (LOWER[counter - 1] ?? String(counter)) + ") ";
    default: return String(counter) + ". ";
  }
}

function formatOutlineRange(
  startChapter: number,
  startVerse: number,
  endChapter: number,
  endVerse: number
): string {
  if (startChapter === endChapter) {
    if (startVerse === endVerse) return `(${startChapter}:${startVerse})`;
    return `(${startChapter}:${startVerse}–${endVerse})`;
  }
  return `(${startChapter}:${startVerse} – ${endChapter}:${endVerse})`;
}

export interface SectionBreakForOutline {
  wordId: string;
  heading: string | null;
  level: number;
  chapter: number;
  verse: number;
  thematic?: boolean;
  thematicLetter?: string | null;
}

export interface SectionRangeForOutline {
  endChapter: number;
  endVerse: number;
}

/**
 * Generates a plain-text hierarchical outline from the given section breaks.
 *
 * @param breaks   Section breaks sorted by (chapter, verse, level)
 * @param ranges   Map keyed by `${wordId}:${level}` → { endChapter, endVerse }
 * @returns        Plain text outline string
 */
export function generateOutline(
  breaks: SectionBreakForOutline[],
  ranges: Map<string, SectionRangeForOutline>
): string {
  const lines: string[] = [];
  // counters[1..6] — reset lower-priority counters when a higher-priority heading is seen
  const counters = [0, 0, 0, 0, 0, 0, 0]; // index 1–6 used

  for (const sb of breaks) {
    const { level } = sb;
    if (level < 1 || level > 6) continue;

    const isThematic = sb.thematic && sb.thematicLetter;

    if (!isThematic) {
      counters[level]++;
      for (let l = level + 1; l <= 6; l++) {
        counters[l] = 0;
      }
    }

    const letterIndex = isThematic
      ? sb.thematicLetter!.toUpperCase().charCodeAt(0) - 65
      : -1;
    const indent = isThematic
      ? "  ".repeat(letterIndex + 1)
      : "  ".repeat(level - 1);
    const prefix = isThematic
      ? sb.thematicLetter! + " "
      : formatPrefix(level, counters[level]);
    const heading = sb.heading?.trim() ?? "(untitled)";

    const rangeKey = `${sb.wordId}:${level}`;
    const range = ranges.get(rangeKey);
    const rangeStr = range
      ? " " + formatOutlineRange(sb.chapter, sb.verse, range.endChapter, range.endVerse)
      : ` (${sb.chapter}:${sb.verse})`;

    lines.push(`${indent}${prefix}${heading}${rangeStr}`);
  }

  return lines.join("\n");
}

/**
 * Triggers a browser download of the outline as a .txt file.
 */
export function downloadOutline(text: string, filename = "outline.txt"): void {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
