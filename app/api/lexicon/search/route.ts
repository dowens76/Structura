import { NextRequest, NextResponse } from "next/server";
import {
  getLexiconDbForSource,
  getLexiconDbsForLanguage,
  HEBREW_LEXICON_SOURCES,
  GREEK_LEXICON_SOURCES,
} from "@/lib/db";
import { lexiconEntries } from "@/lib/db/schema";
import { eq, and, like, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

// GET /api/lexicon/search?q=H12&lang=hebrew&source=BDB&limit=8
// GET /api/lexicon/search?q=λόγ&lang=greek&source=AbbottSmith&limit=8
//
// If q looks like a Strong's identifier (H### or G###) → matches by strong_number prefix.
// Otherwise → matches by lemma prefix.
// Returns up to `limit` lightweight { strongNumber, lemma, shortGloss } objects.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q      = searchParams.get("q")?.trim()      ?? "";
  const lang   = searchParams.get("lang")?.trim()   ?? "";
  const source = searchParams.get("source")?.trim() ?? "";
  const limit  = Math.min(parseInt(searchParams.get("limit") ?? "8", 10), 20);

  if (!q) return NextResponse.json({ results: [] });

  const isStrongQuery = /^[HhGg]\d/i.test(q);

  // ── Resolve which DBs to query ────────────────────────────────────────────
  // If a specific source is given, query that DB only.
  // Otherwise fan out over all DBs for the given language.
  type RowShape = { strongNumber: string | null; lemma: string | null; shortGloss: string | null };

  if (source) {
    const db = getLexiconDbForSource(source);
    if (!db) return NextResponse.json({ results: [] });

    const rows = await db
      .select({
        strongNumber: lexiconEntries.strongNumber,
        lemma:        lexiconEntries.lemma,
        shortGloss:   lexiconEntries.shortGloss,
      })
      .from(lexiconEntries)
      .where(
        and(
          lang ? eq(lexiconEntries.language, lang) : sql`1`,
          isStrongQuery
            ? like(lexiconEntries.strongNumber, `${q.toUpperCase()}%`)
            : like(lexiconEntries.lemma,        `${q}%`),
        )
      )
      .orderBy(
        isStrongQuery
          ? sql`CAST(SUBSTR(strong_number, 2) AS INTEGER)`
          : lexiconEntries.lemma
      )
      .limit(limit);

    return NextResponse.json({ results: rows });
  }

  // No source: fan out and merge.
  const language = (lang === "hebrew" || lang === "greek") ? lang : null;
  const sources  = language === "hebrew"
    ? [...HEBREW_LEXICON_SOURCES]
    : language === "greek"
      ? [...GREEK_LEXICON_SOURCES]
      : [...HEBREW_LEXICON_SOURCES, ...GREEK_LEXICON_SOURCES];

  const seen = new Set<string>();
  const results: RowShape[] = [];

  for (const src of sources) {
    if (results.length >= limit) break;
    const db = getLexiconDbForSource(src);
    if (!db) continue;

    const rows = await db
      .select({
        strongNumber: lexiconEntries.strongNumber,
        lemma:        lexiconEntries.lemma,
        shortGloss:   lexiconEntries.shortGloss,
      })
      .from(lexiconEntries)
      .where(
        and(
          lang ? eq(lexiconEntries.language, lang) : sql`1`,
          isStrongQuery
            ? like(lexiconEntries.strongNumber, `${q.toUpperCase()}%`)
            : like(lexiconEntries.lemma,        `${q}%`),
        )
      )
      .orderBy(
        isStrongQuery
          ? sql`CAST(SUBSTR(strong_number, 2) AS INTEGER)`
          : lexiconEntries.lemma
      )
      .limit(limit);

    for (const row of rows) {
      const key = `${src}:${row.strongNumber ?? row.lemma}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(row);
      }
    }
  }

  return NextResponse.json({ results: results.slice(0, limit) });
}
