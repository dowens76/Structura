import { NextRequest, NextResponse } from "next/server";
import { eq, and, like, inArray, sql } from "drizzle-orm";
import { getOshbDb, getSblgntDb, getLxxDb, oshbLookups, sblgntLookups, normalizeGreekLemma, getLexiconDbsForLanguage } from "@/lib/db";
import { words } from "@/lib/db/source-schema";
import { lexiconEntries } from "@/lib/db/lexica-schema";

export const dynamic = "force-dynamic";

export interface LemmaSuggestion {
  surfaceNorm: string;
  surfaceText: string;
  strongNumber: string | null;
  lemma: string | null;
  gloss: string | null;
  language: "hebrew" | "greek";
}

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 30;

function isHebrew(s: string): boolean {
  return /[א-ת]/.test(s);
}

// Strip Hebrew niqqud (U+05B0–U+05C7) and cantillation (U+0591–U+05AF)
function stripVowels(s: string): string {
  return s.replace(/[֑-ׇ]/g, "");
}

// True if the string has Hebrew consonants but no niqqud — i.e. a root/consonantal query
function isConsonantalHebrew(s: string): boolean {
  return isHebrew(s) && !/[ְ-ׇ]/.test(s);
}

function isGreek(s: string): boolean {
  return /[Ͱ-Ͽἀ-῿]/.test(s);
}

// Strong's number pattern: H1234 or G1234 (with optional trailing letter)
function parseStrongsNumber(s: string): { lang: "hebrew" | "greek"; num: string } | null {
  const m = s.match(/^([HhGg])(\d+[a-z]?)$/);
  if (!m) return null;
  return { lang: m[1].toLowerCase() === "h" ? "hebrew" : "greek", num: m[0].toUpperCase() };
}

async function fetchGlosses(
  strongNums: string[],
  language: "hebrew" | "greek",
): Promise<Map<string, string>> {
  const glossMap = new Map<string, string>();
  if (strongNums.length === 0) return glossMap;

  const dbs = getLexiconDbsForLanguage(language);
  if (dbs.length === 0) return glossMap;

  // Priority: BDB for Hebrew; AbbottSmith > Dodson for Greek.
  const priority: Record<string, number> =
    language === "hebrew"
      ? { BDB: 0 }
      : { AbbottSmith: 0, Dodson: 1, LSJ: 2 };

  for (const { db, source } of dbs) {
    const lexRows = await db
      .select({
        strongNumber: lexiconEntries.strongNumber,
        shortGloss:   lexiconEntries.shortGloss,
        source:       lexiconEntries.source,
      })
      .from(lexiconEntries)
      .where(and(inArray(lexiconEntries.strongNumber, strongNums), eq(lexiconEntries.language, language)));

    const thisPriority = priority[source] ?? 99;
    for (const row of lexRows) {
      if (!row.strongNumber || !row.shortGloss) continue;
      const existing = glossMap.has(row.strongNumber);
      const existingPriority = existing ? (priority[row.source ?? ""] ?? 99) : Infinity;
      if (!existing || thisPriority < existingPriority) {
        glossMap.set(row.strongNumber, row.shortGloss);
      }
    }
  }
  return glossMap;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const limitParam = parseInt(sp.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = Math.min(isNaN(limitParam) ? DEFAULT_LIMIT : limitParam, MAX_LIMIT);

  if (!q) return NextResponse.json({ suggestions: [] });

  // ── Strong's number lookup ─────────────────────────────────────────────────
  const strongs = parseStrongsNumber(q);
  if (strongs) {
    const { lang, num } = strongs;

    let row: { surfaceNorm: string | null; surfaceText: string; strongNumber: string | null; lemma: string | null } | undefined;

    if (lang === "hebrew") {
      const srcId = oshbLookups.textSourceByValue["OSHB"];
      if (srcId != null) {
        const rows = await getOshbDb()
          .select({ surfaceNorm: words.surfaceNorm, surfaceText: words.surfaceText, strongNumber: words.strongNumber, lemma: words.lemma })
          .from(words)
          .where(and(eq(words.textSourceId, srcId), eq(words.strongNumber, num)))
          .groupBy(words.strongNumber, words.lemma)
          .limit(1);
        row = rows[0];
      }
    } else {
      // Greek: a Strong's number may only occur in the NT (SBLGNT) or only
      // in the OT Greek text (LXX) — check both, since they're separate DBs.
      const srcId = sblgntLookups.textSourceByValue["SBLGNT"];
      if (srcId != null) {
        const rows = await getSblgntDb()
          .select({ surfaceNorm: words.surfaceNorm, surfaceText: words.surfaceText, strongNumber: words.strongNumber, lemma: words.lemma })
          .from(words)
          .where(and(eq(words.textSourceId, srcId), eq(words.strongNumber, num)))
          .groupBy(words.strongNumber, words.lemma)
          .limit(1);
        row = rows[0];
      }
      if (!row) {
        const lxxDb = getLxxDb();
        if (lxxDb) {
          const rows = await lxxDb
            .select({ surfaceNorm: words.surfaceNorm, surfaceText: words.surfaceText, strongNumber: words.strongNumber, lemma: words.lemma })
            .from(words)
            .where(eq(words.strongNumber, num))
            .groupBy(words.strongNumber, words.lemma)
            .limit(1);
          row = rows[0];
        }
      }
    }

    if (!row) return NextResponse.json({ suggestions: [] });
    const glossMap = await fetchGlosses([num], lang);
    const suggestion: LemmaSuggestion = {
      surfaceNorm: row.surfaceNorm ?? "",
      surfaceText: row.surfaceText,
      strongNumber: row.strongNumber,
      lemma: row.lemma,
      gloss: glossMap.get(num) ?? null,
      language: lang,
    };
    return NextResponse.json({ suggestions: [suggestion] });
  }

  // ── Hebrew text prefix search — query lexicon for dictionary-form lemmas ─────
  if (isHebrew(q)) {
    const hebrewDbs = getLexiconDbsForLanguage("hebrew");
    if (hebrewDbs.length === 0) return NextResponse.json({ suggestions: [] });

    const consonantal = isConsonantalHebrew(q);
    // For consonantal queries, fetch all entries starting with the first consonant
    // then filter in JS by comparing stripped lemmas.
    const firstConsonant = q[0];
    const dbQuery = consonantal
      ? like(lexiconEntries.lemma, `${firstConsonant}%`)
      : like(lexiconEntries.lemma, `${q}%`);

    type LexRow = { strongNumber: string | null; lemma: string | null; shortGloss: string | null; source: string | null };
    const allRows: LexRow[] = [];

    for (const { db } of hebrewDbs) {
      const rows = await db
        .select({ strongNumber: lexiconEntries.strongNumber, lemma: lexiconEntries.lemma, shortGloss: lexiconEntries.shortGloss, source: lexiconEntries.source })
        .from(lexiconEntries)
        .where(and(eq(lexiconEntries.language, "hebrew"), dbQuery))
        .orderBy(sql`length(${lexiconEntries.lemma})`, lexiconEntries.lemma)
        .limit(consonantal ? 500 : limit * 3);
      allRows.push(...rows);
    }

    // For consonantal queries, filter by stripping vowels from the lemma
    const filtered = consonantal
      ? allRows.filter((r) => r.lemma && stripVowels(r.lemma).startsWith(q))
      : allRows;

    // Deduplicate by strongNumber, preferring BDB
    const priority: Record<string, number> = { BDB: 0 };
    const best = new Map<string, LexRow>();
    for (const row of filtered) {
      if (!row.strongNumber || !row.lemma) continue;
      const existing = best.get(row.strongNumber);
      const existingP = existing ? (priority[existing.source ?? ""] ?? 99) : Infinity;
      const thisP = priority[row.source ?? ""] ?? 99;
      if (!existing || thisP < existingP) best.set(row.strongNumber, row);
    }

    const deduped = [...best.values()].slice(0, limit);
    const suggestions: LemmaSuggestion[] = deduped.map((r) => ({
      surfaceNorm: r.lemma!,
      surfaceText: r.lemma ?? "",
      strongNumber: r.strongNumber,
      lemma: r.lemma,
      gloss: r.shortGloss ?? null,
      language: "hebrew",
    }));
    return NextResponse.json({ suggestions });
  }

  // ── Greek text prefix search ───────────────────────────────────────────────
  // Searches both SBLGNT (NT) and LXX (OT Greek) — separate DBs — and matches
  // on a diacritic/case-normalized form of the lemma, since SBLGNT stores
  // fully accented lemmas while the LXX import stores unaccented lowercase
  // ones.
  if (isGreek(q)) {
    const nq = normalizeGreekLemma(q);
    type Row = { surfaceNorm: string | null; surfaceText: string; strongNumber: string | null; lemma: string | null };
    const allRows: Row[] = [];

    const sblgntId = sblgntLookups.textSourceByValue["SBLGNT"];
    if (sblgntId != null) {
      const rows = await getSblgntDb()
        .select({ surfaceNorm: words.surfaceNorm, surfaceText: words.surfaceText, strongNumber: words.strongNumber, lemma: words.lemma })
        .from(words)
        .where(and(eq(words.textSourceId, sblgntId), sql`greek_normalize(${words.lemma}) LIKE ${nq + "%"}`))
        .groupBy(words.lemma, words.strongNumber)
        .orderBy(sql`length(${words.lemma})`, words.lemma)
        .limit(limit * 2);
      allRows.push(...rows);
    }

    const lxxDb = getLxxDb();
    if (lxxDb) {
      const rows = await lxxDb
        .select({ surfaceNorm: words.surfaceNorm, surfaceText: words.surfaceText, strongNumber: words.strongNumber, lemma: words.lemma })
        .from(words)
        .where(sql`greek_normalize(${words.lemma}) LIKE ${nq + "%"}`)
        .groupBy(words.lemma, words.strongNumber)
        .orderBy(sql`length(${words.lemma})`, words.lemma)
        .limit(limit * 2);
      allRows.push(...rows);
    }

    // Dedupe by normalized lemma, preferring whichever row carries a Strong's number
    const best = new Map<string, Row>();
    for (const row of allRows) {
      if (!row.lemma) continue;
      const key = normalizeGreekLemma(row.lemma);
      const existing = best.get(key);
      if (!existing || (!existing.strongNumber && row.strongNumber)) best.set(key, row);
    }

    const deduped = [...best.values()]
      .sort((a, b) => (a.lemma!.length - b.lemma!.length) || a.lemma!.localeCompare(b.lemma!))
      .slice(0, limit);

    const strongNums = [...new Set(deduped.map((r) => r.strongNumber).filter(Boolean) as string[])];
    const glossMap = await fetchGlosses(strongNums, "greek");

    const suggestions: LemmaSuggestion[] = deduped.map((r) => ({
      surfaceNorm: r.surfaceNorm ?? r.lemma ?? "",
      surfaceText: r.surfaceText,
      strongNumber: r.strongNumber,
      lemma: r.lemma,
      gloss: r.strongNumber ? (glossMap.get(r.strongNumber) ?? null) : null,
      language: "greek",
    }));
    return NextResponse.json({ suggestions });
  }

  return NextResponse.json({ suggestions: [] });
}
