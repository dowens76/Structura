import { NextRequest, NextResponse } from "next/server";
import { eq, and, like, or, asc, SQL } from "drizzle-orm";
import { sourceDb, getLxxDb, sourceLookups, lxxLookups } from "@/lib/db";
import type { LookupById } from "@/lib/db";
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

  const querySourceDb = requestedSources.includes("OSHB") || requestedSources.includes("SBLGNT");
  const queryLxxDb = requestedSources.includes("STEPBIBLE_LXX");

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

  // ── Query sourceDb (OSHB + SBLGNT) ─────────────────────────────────────────
  if (querySourceDb) {
    const posById   = sourceLookups.partOfSpeechById;
    const perById   = sourceLookups.personById;
    const genById   = sourceLookups.genderById;
    const numById   = sourceLookups.wordNumberById;
    const tenById   = sourceLookups.tenseById;
    const voiById   = sourceLookups.voiceById;
    const mooById   = sourceLookups.moodById;
    const stmById   = sourceLookups.stemById;
    const staById   = sourceLookups.stateById;
    const vcById    = sourceLookups.verbCaseById;
    const tsById    = sourceLookups.textSourceByValue;

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

    // Source filter
    const sourceIds: number[] = [];
    for (const src of requestedSources) {
      if (src !== "STEPBIBLE_LXX") {
        const id = tsById[src];
        if (id != null) sourceIds.push(id);
      }
    }
    if (sourceIds.length === 1) {
      conditions.push(eq(words.textSourceId, sourceIds[0]));
    } else if (sourceIds.length > 1) {
      // Both OSHB and SBLGNT — no filter needed (all sourceDb words are one of these)
    }

    // Text filter
    if (searchType === "surface" && q) {
      conditions.push(like(words.surfaceText, `%${q}%`));
    } else if (searchType === "lemma" && q) {
      if (isHebrew(q)) {
        // Search surfaceNorm (Hebrew without cantillation) — fall back to surfaceText
        conditions.push(or(like(words.surfaceNorm, `%${q}%`), like(words.surfaceText, `%${q}%`))!);
      } else if (/^[HG]\d+[a-z]?$/.test(q)) {
        // Exact Strong's number (e.g. H7225, G3056) — match strongNumber column directly
        conditions.push(eq(words.strongNumber, q));
      } else {
        // Generic lemma text search
        conditions.push(like(words.lemma, `%${q}%`));
      }
    }

    // Morphology filters
    if (filterPartOfSpeech && posByVal[filterPartOfSpeech] != null) {
      const posId = posByVal[filterPartOfSpeech];
      if (filterPartOfSpeech === "preposition") {
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
    if (filterPerson && perByVal[filterPerson] != null) {
      conditions.push(eq(words.personId, perByVal[filterPerson]));
    }
    if (filterGender && genByVal[filterGender] != null) {
      conditions.push(eq(words.genderId, genByVal[filterGender]));
    }
    if (filterNumber && numByVal[filterNumber] != null) {
      conditions.push(eq(words.wordNumberId, numByVal[filterNumber]));
    }
    if (filterTense && tenByVal[filterTense] != null) {
      conditions.push(eq(words.tenseId, tenByVal[filterTense]));
    }
    if (filterVoice && voiByVal[filterVoice] != null) {
      conditions.push(eq(words.voiceId, voiByVal[filterVoice]));
    }
    if (filterMood && mooByVal[filterMood] != null) {
      conditions.push(eq(words.moodId, mooByVal[filterMood]));
    }
    if (filterStem && stmByVal[filterStem] != null) {
      conditions.push(eq(words.stemId, stmByVal[filterStem]));
    }
    if (filterState && staByVal[filterState] != null) {
      conditions.push(eq(words.stateId, staByVal[filterState]));
    }
    if (filterVerbCase && vcByVal[filterVerbCase] != null) {
      conditions.push(eq(words.verbCaseId, vcByVal[filterVerbCase]));
    }
    if (morphPatternLike) {
      conditions.push(like(words.morphCode, morphPatternLike));
    }

    const rows = await sourceDb
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
      .limit(limit);

    for (const row of rows) {
      results.push({
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
        language:        sourceLookups.languageById[row.languageId] ?? "",
        textSource:      sourceLookups.textSourceById[row.textSourceId] ?? "",
      });
    }
  }

  // ── Query lxxDb (STEPBIBLE_LXX) ────────────────────────────────────────────
  if (queryLxxDb) {
    const lxxDb = getLxxDb();
    if (lxxDb) {
      const posById   = lxxLookups.partOfSpeechById;
      const perById   = lxxLookups.personById;
      const genById   = lxxLookups.genderById;
      const numById   = lxxLookups.wordNumberById;
      const tenById   = lxxLookups.tenseById;
      const voiById   = lxxLookups.voiceById;
      const mooById   = lxxLookups.moodById;
      const stmById   = lxxLookups.stemById;
      const staById   = lxxLookups.stateById;
      const vcById    = lxxLookups.verbCaseById;

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

      // Text filter
      if (searchType === "surface" && q) {
        conditions.push(like(words.surfaceText, `%${q}%`));
      } else if (searchType === "lemma" && q) {
        if (isHebrew(q)) {
          conditions.push(or(like(words.surfaceNorm, `%${q}%`), like(words.surfaceText, `%${q}%`))!);
        } else if (/^[HG]\d+[a-z]?$/.test(q)) {
          conditions.push(eq(words.strongNumber, q));
        } else {
          conditions.push(like(words.lemma, `%${q}%`));
        }
      }

      // Morphology filters
      if (filterPartOfSpeech && posByVal[filterPartOfSpeech] != null) {
        const posId = posByVal[filterPartOfSpeech];
        if (filterPartOfSpeech === "preposition") {
          conditions.push(or(
            eq(words.partOfSpeechId, posId),
            like(words.morphCode, "HR/%"),
            like(words.morphCode, "H%/R/%"),
          )!);
        } else {
          conditions.push(eq(words.partOfSpeechId, posId));
        }
      }
      if (filterPerson && perByVal[filterPerson] != null) {
        conditions.push(eq(words.personId, perByVal[filterPerson]));
      }
      if (filterGender && genByVal[filterGender] != null) {
        conditions.push(eq(words.genderId, genByVal[filterGender]));
      }
      if (filterNumber && numByVal[filterNumber] != null) {
        conditions.push(eq(words.wordNumberId, numByVal[filterNumber]));
      }
      if (filterTense && tenByVal[filterTense] != null) {
        conditions.push(eq(words.tenseId, tenByVal[filterTense]));
      }
      if (filterVoice && voiByVal[filterVoice] != null) {
        conditions.push(eq(words.voiceId, voiByVal[filterVoice]));
      }
      if (filterMood && mooByVal[filterMood] != null) {
        conditions.push(eq(words.moodId, mooByVal[filterMood]));
      }
      if (filterStem && stmByVal[filterStem] != null) {
        conditions.push(eq(words.stemId, stmByVal[filterStem]));
      }
      if (filterState && staByVal[filterState] != null) {
        conditions.push(eq(words.stateId, staByVal[filterState]));
      }
      if (filterVerbCase && vcByVal[filterVerbCase] != null) {
        conditions.push(eq(words.verbCaseId, vcByVal[filterVerbCase]));
      }
      if (morphPatternLike) {
        conditions.push(like(words.morphCode, morphPatternLike));
      }

      // LXX books table lives in lxxDb but the osisCode/name/bookNumber live in sourceDb.
      // Query lxx words then join with sourceDb books for display names.
      const lxxRows = await lxxDb
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
        .limit(limit);

      for (const row of lxxRows) {
        results.push({
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
          language:        lxxLookups.languageById[row.languageId] ?? "",
          textSource:      "STEPBIBLE_LXX",
        });
      }
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
