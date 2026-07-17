/**
 * Shared parsing helpers for the UBS Hebrew/Greek NT Dictionary importers
 * (scripts/import-ubs-hebrew.ts, scripts/import-ubs-greek.ts).
 *
 * Source data: BibleAquifer's Aquifer-format JSON export of the UBS
 * dictionaries (semantic lexica adapted from SDBH/SDBG):
 *   https://github.com/BibleAquifer/UBSHebrewDictionary
 *   https://github.com/BibleAquifer/UBSGreekNTDictionary
 * Each `eng/json/NNN.content.json` file is an array of entries; each entry's
 * `content` field is a full, self-contained HTML fragment (with its own
 * <style> block, identical across every entry) built around a headword
 * (`title`) and one or more Strong's-numbered senses.
 */

export interface UbsMetadata {
  scripture_burrito: {
    ingredients: Record<string, { size: number }>;
  };
}

export interface UbsRawEntry {
  title: string;
  content: string;
}

export interface ParsedUbsEntry {
  lemma: string;
  strongNumbers: string[]; // normalized, e.g. "H32", "G18"
  shortGloss: string | null;
  definition: string; // entry HTML with the shared <style> block stripped
}

/** Lists the `eng/json/*.content.json` ingredient paths for a UBS Aquifer repo. */
export async function listContentFiles(repo: string): Promise<string[]> {
  const url = `https://raw.githubusercontent.com/BibleAquifer/${repo}/main/eng/metadata.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const meta = (await res.json()) as UbsMetadata;
  return Object.keys(meta.scripture_burrito.ingredients)
    .filter((k) => k.startsWith("json/") && k.endsWith(".content.json"))
    .sort();
}

/** Splits a raw `<span class="lex-strong">` code list ("H0410+H1285", "H0032b")
 *  into normalized Strong's numbers matching this app's convention (no
 *  leading zeros, no dictionary-variant letter suffix) for the given prefix.
 *  Codes with a different prefix (e.g. Hebrew's internal "A"-numbers) are
 *  dropped. */
export function normalizeStrongCodes(raw: string, prefix: "H" | "G"): string[] {
  const out: string[] = [];
  for (const seg of raw.split(/[+,\s]+/)) {
    const m = seg.trim().match(/^([A-Za-z])(\d+)[a-z]?$/);
    if (m && m[1].toUpperCase() === prefix) {
      out.push(`${prefix}${parseInt(m[2], 10)}`);
    }
  }
  return out;
}

const STRONG_SPAN_RE = /<span class="lex-strong">([^<]+)<\/span>/g;
const SENSE_RE = /<p class="lex-sense">([\s\S]*?)<\/p>/;
const GLOSS_RE = /<span class="lex-gloss">([^<]*)<\/span>/g;
const STYLE_RE = /<style>[\s\S]*?<\/style>/;

/** Parses one Aquifer entry's `content` HTML into the fields this app's
 *  lexicon_entries schema needs. Returns null when the entry has no
 *  Strong's number for the target language — those aren't reachable
 *  through the app's Strong's-number/lemma-based lookup regardless. */
export function parseUbsEntry(entry: UbsRawEntry, prefix: "H" | "G"): ParsedUbsEntry | null {
  const lemma = entry.title.trim();
  if (!lemma) return null;

  const strongCodes = [...entry.content.matchAll(STRONG_SPAN_RE)].map((m) => m[1]);
  const strongNumbers = [...new Set(strongCodes.flatMap((c) => normalizeStrongCodes(c, prefix)))];
  if (strongNumbers.length === 0) return null;

  const senseMatch = entry.content.match(SENSE_RE);
  const glosses = senseMatch
    ? [...senseMatch[1].matchAll(GLOSS_RE)].map((g) => g[1].trim()).filter(Boolean)
    : [];
  const shortGloss = glosses.length > 0 ? glosses.join(", ") : null;

  const definition = entry.content.replace(STYLE_RE, "").trim();

  return { lemma, strongNumbers, shortGloss, definition };
}
