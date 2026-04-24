import { NextRequest, NextResponse } from "next/server";
import { lexicaDb } from "@/lib/db";
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

  if (!q || !lexicaDb) return NextResponse.json({ results: [] });

  const isStrongQuery = /^[HhGg]\d/i.test(q);

  const rows = await lexicaDb
    .select({
      strongNumber: lexiconEntries.strongNumber,
      lemma:        lexiconEntries.lemma,
      shortGloss:   lexiconEntries.shortGloss,
    })
    .from(lexiconEntries)
    .where(
      and(
        lang   ? eq(lexiconEntries.language, lang)   : sql`1`,
        source ? eq(lexiconEntries.source,   source) : sql`1`,
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
