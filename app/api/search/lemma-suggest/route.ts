import { NextRequest, NextResponse } from "next/server";
import { eq, and, like, inArray, sql } from "drizzle-orm";
import { sourceDb, lexicaDb, sourceLookups } from "@/lib/db";
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
  if (!lexicaDb || strongNums.length === 0) return glossMap;

  const lexRows = await lexicaDb
    .select({ strongNumber: lexiconEntries.strongNumber, shortGloss: lexiconEntries.shortGloss, source: lexiconEntries.source })
    .from(lexiconEntries)
    .where(and(inArray(lexiconEntries.strongNumber, strongNums), eq(lexiconEntries.language, language)));

  const hebrewPriority: Record<string, number> = { BDB: 0, HebrewStrong: 1 };
  const greekPriority: Record<string, number> = { AbottSmith: 0, GreekStrong: 1 };
  const priority = language === "hebrew" ? hebrewPriority : greekPriority;

  for (const row of lexRows) {
    if (!row.strongNumber || !row.shortGloss) continue;
    const existing = glossMap.has(row.strongNumber);
    const existingPriority = existing ? (priority[row.source ?? ""] ?? 99) : Infinity;
    const thisPriority = priority[row.source ?? ""] ?? 99;
    if (!existing || thisPriority < existingPriority) {
      glossMap.set(row.strongNumber, row.shortGloss);
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
    const srcId = lang === "hebrew"
      ? sourceLookups.textSourceByValue["OSHB"]
      : sourceLookups.textSourceByValue["SBLGNT"];
    if (srcId == null) return NextResponse.json({ suggestions: [] });

    const rows = await sourceDb
      .select({ surfaceNorm: words.surfaceNorm, surfaceText: words.surfaceText, strongNumber: words.strongNumber, lemma: words.lemma })
      .from(words)
      .where(and(eq(words.textSourceId, srcId), eq(words.strongNumber, num)))
      .groupBy(words.strongNumber, words.lemma)
      .limit(1);

    if (rows.length === 0) return NextResponse.json({ suggestions: [] });
    const row = rows[0];
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

  // ── Hebrew text prefix search ──────────────────────────────────────────────
  if (isHebrew(q)) {
    const oshbId = sourceLookups.textSourceByValue["OSHB"];
    if (oshbId == null) return NextResponse.json({ suggestions: [] });

    const rows = await sourceDb
      .select({ surfaceNorm: words.surfaceNorm, surfaceText: words.surfaceText, strongNumber: words.strongNumber, lemma: words.lemma })
      .from(words)
      .where(and(eq(words.textSourceId, oshbId), like(words.surfaceNorm, `${q}%`)))
      .groupBy(words.surfaceNorm, words.strongNumber, words.lemma)
      .orderBy(sql`length(${words.surfaceNorm})`, words.surfaceNorm)
      .limit(limit);

    const filtered = rows.filter((r) => r.surfaceNorm);
    const strongNums = [...new Set(filtered.map((r) => r.strongNumber).filter(Boolean) as string[])];
    const glossMap = await fetchGlosses(strongNums, "hebrew");

    const suggestions: LemmaSuggestion[] = filtered.map((r) => ({
      surfaceNorm: r.surfaceNorm!,
      surfaceText: r.surfaceText,
      strongNumber: r.strongNumber,
      lemma: r.lemma,
      gloss: r.strongNumber ? (glossMap.get(r.strongNumber) ?? null) : null,
      language: "hebrew",
    }));
    return NextResponse.json({ suggestions });
  }

  // ── Greek text prefix search ───────────────────────────────────────────────
  if (isGreek(q)) {
    const sblgntId = sourceLookups.textSourceByValue["SBLGNT"];
    if (sblgntId == null) return NextResponse.json({ suggestions: [] });

    const rows = await sourceDb
      .select({ surfaceNorm: words.surfaceNorm, surfaceText: words.surfaceText, strongNumber: words.strongNumber, lemma: words.lemma })
      .from(words)
      .where(and(eq(words.textSourceId, sblgntId), like(words.lemma, `${q}%`)))
      .groupBy(words.lemma, words.strongNumber)
      .orderBy(sql`length(${words.lemma})`, words.lemma)
      .limit(limit);

    const filtered = rows.filter((r) => r.lemma);
    const strongNums = [...new Set(filtered.map((r) => r.strongNumber).filter(Boolean) as string[])];
    const glossMap = await fetchGlosses(strongNums, "greek");

    const suggestions: LemmaSuggestion[] = filtered.map((r) => ({
      surfaceNorm: r.surfaceNorm ?? "",
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
