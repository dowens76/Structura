/**
 * Tolerant OSIS-ref parsing for scripture citations embedded inside lexicon
 * entries (BDB `<ref r="...">`, Abbott-Smith `<ref osisRef="...">`, and
 * STEPBible LSJ's non-standard `<ref='...'>`), plus the book -> text-source
 * routing rule for opening those citations in Structura.
 *
 * Kept separate from lib/utils/osis.ts because parseOsisRef there
 * intentionally throws on malformed input and other callers rely on that
 * strict contract — lexicon citation data is dirtier (ranges, chapter-only
 * refs, typoed separators) and must degrade to "not clickable" instead.
 */

import { OSIS_BOOK_NAMES, OSIS_BOOKS_OT, OSIS_BOOKS_NT, OSIS_BOOKS_LXX } from "./osis";

export interface ParsedLexiconRef {
  book: string;
  chapter: number;
  verse: number;
}

// Book-abbreviation aliases from the lexicon sources whose citations don't
// use this app's canonical OSIS codes. Two dialects feed this one table:
//  - STEPBible's LSJ data uses its own 3-4 letter abbreviations (e.g. "Exo",
//    "Luk", "Act", "Jhn"). "3Ki"/"4Ki" (LXX Kingdoms numbering) are
//    deliberately omitted — mapping them would require guessing a
//    versification shift, so they fall through and stay plain text.
//  - The full BDB text's `data-ref` citations use a different, shorter
//    dialect (e.g. "Ge", "Ex", "Nu", "Jam", "Da"), plus a handful of rare
//    inconsistent alternates for the same books found in the source data
//    ("Gn"/"Lv"/"Dt"/"Jud"-for-Judges). The two dialects don't collide, so a
//    single merged table is safe.
const LEXICON_BOOK_ALIASES: Record<string, string> = {
  // STEPBible (LSJ)
  Exo: "Exod", Jdg: "Judg", Rut: "Ruth",
  "1Sa": "1Sam", "2Sa": "2Sam", "1Ki": "1Kgs", "2Ki": "2Kgs",
  "1Ch": "1Chr", "2Ch": "2Chr", Est: "Esth", Psa: "Ps", Pro: "Prov",
  Ezk: "Ezek", Amo: "Amos", Zec: "Zech", "1Ma": "1Macc", "2Ma": "2Macc",
  Mat: "Matt", Mrk: "Mark", Luk: "Luke", Jhn: "John", Act: "Acts",
  "1Co": "1Cor", "2Co": "2Cor", Php: "Phil",
  "1Th": "1Thess", "2Th": "2Thess", "1Ti": "1Tim", "2Ti": "2Tim", Tit: "Titus",
  "1Pe": "1Pet", "2Pe": "2Pet", "1Jn": "1John", "2Jn": "2John", "3Jn": "3John",
  // Full BDB text
  Ge: "Gen", Ex: "Exod", Le: "Lev", Nu: "Num", De: "Deut", Jos: "Josh",
  Ru: "Ruth", Ezr: "Ezra", Ne: "Neh", Es: "Esth", Pr: "Prov", Ec: "Eccl",
  So: "Song", Ct: "Song", Is: "Isa", Je: "Jer", Eze: "Ezek", Da: "Dan",
  Ho: "Hos", Joe: "Joel", Am: "Amos", Ob: "Obad", Jon: "Jonah", Na: "Nah",
  Zep: "Zeph", Mt: "Matt", Mk: "Mark", Lu: "Luke", Jn: "John", Ac: "Acts",
  Ro: "Rom", Ga: "Gal", Jam: "Jas",
  // Rare inconsistent alternates observed in the full BDB text
  Gn: "Gen", Lv: "Lev", Dt: "Deut", Jo: "Josh", Jud: "Judg", Ez: "Ezra",
};

/** Resolves a book code to its canonical OSIS form, trying an exact match
 *  before falling back to the lexicon-specific alias table. Returns null if
 *  neither recognizes it. */
function resolveBookCode(code: string): string | null {
  if (OSIS_BOOK_NAMES[code]) return code;
  const alias = LEXICON_BOOK_ALIASES[code];
  return alias && OSIS_BOOK_NAMES[alias] ? alias : null;
}

/**
 * Parses a single lexicon `<ref>` attribute value into a clean OSIS ref.
 * Never throws — returns null for anything it can't confidently resolve,
 * which callers must treat as "leave this citation as plain text".
 *
 * `inheritedBook` lets a bare "7.11" segment (from a STEPBible multi-ref tag
 * that omits the book on later segments) resolve against the previous
 * segment's book.
 */
export function parseLexiconOsisRef(raw: string, inheritedBook?: string): ParsedLexiconRef | null {
  let s = raw.trim();
  if (!s) return null;

  s = s.replace(/^LXX:/i, "");        // stray "LXX:Ps.30.4" prefix
  s = s.split("-")[0].trim();         // ranges "Exod.3.12-Exod.3.15" — take the start
  s = s.split("!")[0].trim();         // sub-verse letters "1Chr.9.8!a"
  s = s.replace(/^([1-4]?[A-Za-z]+)\s+(?=\d)/, "$1."); // full BDB's "Nu 24:20" (space-separated) -> "Nu.24:20"
  s = s.replace(/:/g, ".").replace(/,/g, "."); // colon/comma typos ("Job.37:23", "Ezra,6,15")

  let parts = s.split(".").map((p) => p.trim()).filter(Boolean);

  // Missing dot between book and chapter, e.g. "Exod24.17" -> "Exod" "24" "17"
  if (parts.length === 2) {
    const m = parts[0].match(/^(\d*[A-Za-z]+)(\d+)$/);
    if (m) parts = [m[1], m[2], parts[1]];
  }

  // Bare "chapter.verse" inheriting the book from a prior multi-ref segment
  if (parts.length === 2 && /^\d+$/.test(parts[0]) && inheritedBook) {
    parts = [inheritedBook, parts[0], parts[1]];
  }

  // Chapter-only citation, e.g. "Ps.33"
  if (parts.length === 2 && resolveBookCode(parts[0])) {
    parts = [parts[0], parts[1], "1"];
  }

  if (parts.length < 3) return null;

  const [rawBook, chStr, vStr] = parts;
  const book = resolveBookCode(rawBook);
  if (!book) return null;
  const chapter = parseInt(chStr, 10);
  const verse = parseInt(vStr, 10);
  if (!Number.isFinite(chapter) || !Number.isFinite(verse) || chapter < 1 || verse < 1) return null;
  return { book, chapter, verse };
}

/**
 * Splits a STEPBible multi-ref tag's raw attribute ("Heb.5.4; 7.11; 9.4") and
 * display text ("Heb.5:4, 7:11, 9:4") into per-segment {osisRef, label}
 * pairs. Returns null if the segment counts don't line up or any segment
 * fails to parse — caller should then fall back to plain (non-clickable)
 * text for the whole tag rather than partially linkify it.
 */
export function splitStepBibleMultiRef(
  rawAttr: string,
  displayText: string
): { osisRef: string; label: string }[] | null {
  const refParts = rawAttr.split(/;\s*/).map((s) => s.trim()).filter(Boolean);
  const labelParts = displayText.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  if (refParts.length === 0 || refParts.length !== labelParts.length) return null;

  let inheritedBook: string | undefined;
  const out: { osisRef: string; label: string }[] = [];
  for (let i = 0; i < refParts.length; i++) {
    const parsed = parseLexiconOsisRef(refParts[i], inheritedBook);
    if (!parsed) return null;
    inheritedBook = parsed.book;
    out.push({ osisRef: `${parsed.book}.${parsed.chapter}.${parsed.verse}`, label: labelParts[i] });
  }
  return out;
}

export type LexiconSourceKind = "BDB" | "AbbottSmith" | "LSJ";

/**
 * Centralized book -> text-source routing rule for opening a lexicon
 * citation. BDB is a Hebrew lexicon (its refs are always OT verses); Abbott-
 * Smith and LSJ are Greek lexica whose refs may cite NT or LXX/OT verses.
 * Returns null when the book can't be resolved to any interlinear source we
 * have.
 */
export function pickPassageSource(
  kind: LexiconSourceKind,
  book: string
): "OSHB" | "SBLGNT" | "STEPBIBLE_LXX" | null {
  if (kind === "BDB") {
    return OSIS_BOOKS_OT.includes(book) ? "OSHB" : null;
  }
  if (OSIS_BOOKS_NT.includes(book)) return "SBLGNT";
  if (OSIS_BOOKS_OT.includes(book) || OSIS_BOOKS_LXX.includes(book)) return "STEPBIBLE_LXX";
  return null;
}
