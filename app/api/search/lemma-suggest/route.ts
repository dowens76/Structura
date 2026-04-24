import { NextRequest, NextResponse } from "next/server";
import { eq, and, like, inArray, sql, SQL } from "drizzle-orm";
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
}

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 30;

// Detect Hebrew characters
function isHebrew(s: string): boolean {
  return /[\u05D0-\u05EA]/.test(s);
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const limitParam = parseInt(sp.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = Math.min(isNaN(limitParam) ? DEFAULT_LIMIT : limitParam, MAX_LIMIT);

  if (!q || !isHebrew(q)) {
    return NextResponse.json({ suggestions: [] });
  }

  const tsById = sourceLookups.textSourceByValue;
  const oshbId = tsById["OSHB"];
  if (oshbId == null) {
    return NextResponse.json({ suggestions: [] });
  }

  const conditions: SQL[] = [eq(words.textSourceId, oshbId)];

  // Prefix match on surfaceNorm — most relevant for Hebrew entry
  conditions.push(like(words.surfaceNorm, `${q}%`));

  // Select distinct (surfaceNorm, surfaceText, strongNumber, lemma)
  const rows = await sourceDb
    .select({
      surfaceNorm: words.surfaceNorm,
      surfaceText: words.surfaceText,
      strongNumber: words.strongNumber,
      lemma: words.lemma,
    })
    .from(words)
    .where(and(...conditions))
    .groupBy(words.surfaceNorm, words.strongNumber, words.lemma)
    .orderBy(sql`length(${words.surfaceNorm})`, words.surfaceNorm)
    .limit(limit);

  const filtered = rows.filter((r) => r.surfaceNorm);

  // Fetch glosses from lexicaDb for all unique Strong's numbers (prefer BDB, fall back to HebrewStrong)
  const glossMap = new Map<string, string>();
  if (lexicaDb && filtered.length > 0) {
    const strongNums = [...new Set(filtered.map((r) => r.strongNumber).filter(Boolean) as string[])];
    if (strongNums.length > 0) {
      const lexRows = await lexicaDb
        .select({ strongNumber: lexiconEntries.strongNumber, shortGloss: lexiconEntries.shortGloss, source: lexiconEntries.source })
        .from(lexiconEntries)
        .where(and(inArray(lexiconEntries.strongNumber, strongNums), eq(lexiconEntries.language, "hebrew")));

      // Prefer BDB, then HebrewStrong
      const priority: Record<string, number> = { BDB: 0, HebrewStrong: 1 };
      for (const row of lexRows) {
        if (!row.strongNumber || !row.shortGloss) continue;
        const existing = glossMap.has(row.strongNumber);
        const existingPriority = existing ? (priority[row.source ?? ""] ?? 99) : Infinity;
        const thisPriority = priority[row.source ?? ""] ?? 99;
        if (!existing || thisPriority < existingPriority) {
          glossMap.set(row.strongNumber, row.shortGloss);
        }
      }
    }
  }

  const suggestions: LemmaSuggestion[] = filtered.map((r) => ({
    surfaceNorm: r.surfaceNorm!,
    surfaceText: r.surfaceText,
    strongNumber: r.strongNumber,
    lemma: r.lemma,
    gloss: r.strongNumber ? (glossMap.get(r.strongNumber) ?? null) : null,
  }));

  return NextResponse.json({ suggestions });
}
