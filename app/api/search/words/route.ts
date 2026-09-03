import { NextRequest, NextResponse } from "next/server";
import { eq, and, like, or, asc, sql, SQL } from "drizzle-orm";
import { getOshbDb, getSblgntDb, getLxxDb, oshbLookups, sblgntLookups, lxxLookups, normalizeGreekLemma } from "@/lib/db";
import type { LookupById, LookupMaps } from "@/lib/db";
import { words, books } from "@/lib/db/source-schema";

export const dynamic = "force-dynamic";

// Detect if a string contains Hebrew characters (U+05D0–U+05EA)
function isHebrew(s: string): boolean {
  return /[\u05D0-\u05EA]/.test(s);
}

export interface SearchResult {
  wordId: string;
  book: string;
  bookName: string;
  bookNumber: number;
  chapter: number;
  verse: number;
  positionInVerse: number;
  surfaceText: string;
  lemma: string | null;
  strongNumber: string | null;
  morphCode: string | null;
  partOfSpeech: string | null;
  language: string;
  textSource: string;
}

// Invert a byId map to get value → id
function invertMap(byId: LookupById): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(byId)) {
    out[value] = Number(id);
  }
  return out;
}

const VALID_SOURCES = new Set(["OSHB", "SBLGNT", "STEPBIBLE_LXX"]);
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

interface QueryOpts {
  q: string;
  searchType: string;
  filterPartOfSpeech: string;
  filterPerson: string;
  filterGender: string;
  filterNumber: string;
  filterTense: string;
  filterVoice: string;
  filterMood: string;
  filterStem: string;
  filterState: string;
  filterVerbCase: string;
  morphPatternLike: string;
  limit: number;
  /** SBLGNT/LXX only — the Greek dbs have a `greek_normalize` SQL function
   *  registered so accent/case differences between sources (e.g. SBLGNT's
   *  accented lemmas vs. LXX's unaccented ones) don't hide matches. */
  useGreekNormalize: boolean;
}

/**
 * Runs one source's word query (OSHB, SBLGNT, or LXX each live in their own
 * SQLite file — see lib/db/index.ts). `textSourceId` filters to a single
 * source when the db can hold more than one (defensive fallback path only;
 * LXX's db is single-source, so it passes null).
 */
async function queryOneSource(
  db: ReturnType<typeof getOshbDb>,
  lookups: LookupMaps,
  textSourceId: number | null,
  fallbackTextSource: string,
  opts: QueryOpts,
): Promise<SearchResult[]> {
  const posById   = lookups.partOfSpeechById;
  const perById   = lookups.personById;
  const genById   = lookups.genderById;
  const numById   = lookups.wordNumberById;
  const tenById   = lookups.tenseById;
  const voiById   = lookups.voiceById;
  const mooById   = lookups.moodById;
  const stmById   = lookups.stemById;
  const staById   = lookups.stateById;
  const vcById    = lookups.verbCaseById;

  const posByVal  = invertMap(posById);
  const perByVal  = invertMap(perById);
  const genByVal  = invertMap(genById);
  const numByVal  = invertMap(numById);
  const tenByVal  = invertMap(tenById);
  const voiByVal  = invertMap(voiById);
  const mooByVal  = invertMap(mooById);
  const stmByVal  = invertMap(stmById);
  const staByVal  = invertMap(staById);
  const vcByVal   = invertMap(vcById);

  const conditions: SQL[] = [];

  if (textSourceId != null) conditions.push(eq(words.textSourceId, textSourceId));

  // Text filter
  const q = opts.q;
  if (opts.searchType === "surface" && q) {
    conditions.push(like(words.surfaceText, `%${q}%`));
  } else if (opts.searchType === "lemma" && q) {
    if (isHebrew(q)) {
      // Search surfaceNorm (Hebrew without cantillation) — fall back to surfaceText
      conditions.push(or(like(words.surfaceNorm, `%${q}%`), like(words.surfaceText, `%${q}%`))!);
    } else if (/^[HG]\d+[a-z]?$/i.test(q)) {
      // Exact Strong's number (e.g. H7225, G3056) — match strongNumber column directly
      conditions.push(eq(words.strongNumber, q.toUpperCase()));
    } else if (opts.useGreekNormalize) {
      const nq = normalizeGreekLemma(q);
      conditions.push(sql`greek_normalize(${words.lemma}) LIKE ${"%" + nq + "%"}`);
    } else {
      // Generic lemma text search
      conditions.push(like(words.lemma, `%${q}%`));
    }
  }

  // Morphology filters
  if (opts.filterPartOfSpeech && posByVal[opts.filterPartOfSpeech] != null) {
    const posId = posByVal[opts.filterPartOfSpeech];
    if (opts.filterPartOfSpeech === "preposition") {
      // Also include words where R (preposition) appears as an inseparable prefix morpheme
      conditions.push(or(
        eq(words.partOfSpeechId, posId),
        like(words.morphCode, "HR/%"),
        like(words.morphCode, "H%/R/%"),
      )!);
    } else {
      conditions.push(eq(words.partOfSpeechId, posId));
    }
  }
  if (opts.filterPerson && perByVal[opts.filterPerson] != null) {
    conditions.push(eq(words.personId, perByVal[opts.filterPerson]));
  }
  if (opts.filterGender && genByVal[opts.filterGender] != null) {
    conditions.push(eq(words.genderId, genByVal[opts.filterGender]));
  }
  if (opts.filterNumber && numByVal[opts.filterNumber] != null) {
    conditions.push(eq(words.wordNumberId, numByVal[opts.filterNumber]));
  }
  if (opts.filterTense && tenByVal[opts.filterTense] != null) {
    conditions.push(eq(words.tenseId, tenByVal[opts.filterTense]));
  }
  if (opts.filterVoice && voiByVal[opts.filterVoice] != null) {
    conditions.push(eq(words.voiceId, voiByVal[opts.filterVoice]));
  }
  if (opts.filterMood && mooByVal[opts.filterMood] != null) {
    conditions.push(eq(words.moodId, mooByVal[opts.filterMood]));
  }
  if (opts.filterStem && stmByVal[opts.filterStem] != null) {
    conditions.push(eq(words.stemId, stmByVal[opts.filterStem]));
  }
  if (opts.filterState && staByVal[opts.filterState] != null) {
    conditions.push(eq(words.stateId, staByVal[opts.filterState]));
  }
  if (opts.filterVerbCase && vcByVal[opts.filterVerbCase] != null) {
    conditions.push(eq(words.verbCaseId, vcByVal[opts.filterVerbCase]));
  }
  if (opts.morphPatternLike) {
    conditions.push(like(words.morphCode, opts.morphPatternLike));
  }

  const rows = await db
    .select({
      wordId:          words.wordId,
      chapter:         words.chapter,
      verse:           words.verse,
      positionInVerse: words.positionInVerse,
      surfaceText:     words.surfaceText,
      lemma:           words.lemma,
      strongNumber:    words.strongNumber,
      morphCode:       words.morphCode,
      partOfSpeechId:  words.partOfSpeechId,
      textSourceId:    words.textSourceId,
      languageId:      words.languageId,
      bookId:          words.bookId,
      bookOsisCode:    books.osisCode,
      bookName:        books.name,
      bookNumber:      books.bookNumber,
    })
    .from(words)
    .innerJoin(books, eq(words.bookId, books.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(books.bookNumber), asc(words.chapter), asc(words.verse), asc(words.positionInVerse))
    .limit(opts.limit);

  return rows.map((row) => ({
    wordId:          row.wordId,
    book:            row.bookOsisCode,
    bookName:        row.bookName,
    bookNumber:      row.bookNumber,
    chapter:         row.chapter,
    verse:           row.verse,
    positionInVerse: row.positionInVerse,
    surfaceText:     row.surfaceText,
    lemma:           row.lemma,
    strongNumber:    row.strongNumber,
    morphCode:       row.morphCode,
    partOfSpeech:    row.partOfSpeechId != null ? (posById[row.partOfSpeechId] ?? null) : null,
    language:        lookups.languageById[row.languageId] ?? "",
    textSource:      lookups.textSourceById[row.textSourceId] ?? fallbackTextSource,
  }));
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  const q = sp.get("q")?.trim() ?? "";
  const searchType = sp.get("searchType") ?? "surface"; // surface | lemma | morph
  const sourceParam = sp.get("source") ?? "";
  const limitParam = parseInt(sp.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = Math.min(isNaN(limitParam) ? DEFAULT_LIMIT : limitParam, MAX_LIMIT);

  // Parse which sources to query
  const requestedSources = sourceParam
    ? sourceParam.split(",").map((s) => s.trim()).filter((s) => VALID_SOURCES.has(s))
    : ["OSHB", "SBLGNT", "STEPBIBLE_LXX"];

  // Morphology filter params
  const filterPartOfSpeech = sp.get("partOfSpeech") ?? "";
  const filterPerson       = sp.get("person") ?? "";
  const filterGender       = sp.get("gender") ?? "";
  const filterNumber       = sp.get("number") ?? "";
  const filterTense        = sp.get("tense") ?? "";
  const filterVoice        = sp.get("voice") ?? "";
  const filterMood         = sp.get("mood") ?? "";
  const filterStem         = sp.get("stem") ?? "";
  const filterState        = sp.get("state") ?? "";
  const filterVerbCase     = sp.get("verbCase") ?? "";
  // Raw morph code pattern: "-" → "_" (any single char), "*" → "%" (any sequence)
  const morphPatternRaw    = sp.get("morphPattern")?.trim() ?? "";
  const morphPatternLike   = morphPatternRaw
    ? morphPatternRaw.replace(/-/g, "_").replace(/\*/g, "%")
    : "";

  // Validate: need either a text query or at least one morphology filter
  if (searchType !== "morph" && q.length === 0) {
    return NextResponse.json({ error: "Query required" }, { status: 400 });
  }
  if (
    searchType === "morph" &&
    !filterPartOfSpeech && !filterPerson && !filterGender && !filterNumber &&
    !filterTense && !filterVoice && !filterMood && !filterStem && !filterState && !filterVerbCase &&
    !morphPatternLike
  ) {
    return NextResponse.json({ error: "At least one morphology filter required" }, { status: 400 });
  }

  const results: SearchResult[] = [];

  const baseOpts = {
    q, searchType,
    filterPartOfSpeech, filterPerson, filterGender, filterNumber,
    filterTense, filterVoice, filterMood, filterStem, filterState, filterVerbCase,
    morphPatternLike, limit,
  };

  // ── Query OSHB (Hebrew OT) and SBLGNT (Greek NT) — each lives in its own DB ──
  const perSourceResults = await Promise.all([
    requestedSources.includes("OSHB")
      ? queryOneSource(getOshbDb(), oshbLookups, oshbLookups.textSourceByValue["OSHB"] ?? null, "OSHB", { ...baseOpts, useGreekNormalize: false })
      : Promise.resolve([] as SearchResult[]),
    requestedSources.includes("SBLGNT")
      ? queryOneSource(getSblgntDb(), sblgntLookups, sblgntLookups.textSourceByValue["SBLGNT"] ?? null, "SBLGNT", { ...baseOpts, useGreekNormalize: true })
      : Promise.resolve([] as SearchResult[]),
  ]);
  results.push(...perSourceResults[0], ...perSourceResults[1]);

  // ── Query LXX (Greek OT) — single-source DB, no textSourceId filter needed ──
  if (requestedSources.includes("STEPBIBLE_LXX")) {
    const lxxDb = getLxxDb();
    if (lxxDb) {
      results.push(...await queryOneSource(lxxDb, lxxLookups, null, "STEPBIBLE_LXX", { ...baseOpts, useGreekNormalize: true }));
    }
  }

  // Sort merged results canonically and apply final limit
  results.sort((a, b) => {
    if (a.bookNumber !== b.bookNumber) return a.bookNumber - b.bookNumber;
    if (a.chapter !== b.chapter) return a.chapter - b.chapter;
    if (a.verse !== b.verse) return a.verse - b.verse;
    return a.positionInVerse - b.positionInVerse;
  });

  const total = results.length;
  const truncated = total >= limit;
  const finalResults = results.slice(0, limit);

  return NextResponse.json({ results: finalResults, total, truncated });
}
