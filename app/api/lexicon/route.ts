import { NextRequest, NextResponse } from "next/server";
import { getLexiconDbForSource, getLexiconDbsForLanguage } from "@/lib/db";
import { lexiconEntries } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

// GET /api/lexicon?lemma=ἄβυσσος&source=AbbottSmith   (Greek — lemma-based)
// GET /api/lexicon?strong=H7225&source=BDB             (Hebrew — strong-number-based)
//
// Lemma lookup is preferred for Greek (SBLGNT / LXX have reliable lemmas).
// Falls back to any entry for the lemma/strong when preferred source has none.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lemma  = searchParams.get("lemma")?.trim()  ?? null;
  const strong = searchParams.get("strong")?.trim() ?? null;
  const source = searchParams.get("source")?.trim() ?? null;

  if (!lemma && !strong) {
    return NextResponse.json({ entry: null });
  }

  // ── Lemma-based lookup (Greek) ────────────────────────────────────────────
  if (lemma) {
    // Try the requested source DB first (or the legacy combined DB).
    if (source) {
      const db = getLexiconDbForSource(source);
      if (db) {
        const rows = await db
          .select()
          .from(lexiconEntries)
          .where(and(eq(lexiconEntries.lemma, lemma), eq(lexiconEntries.source, source)))
          .limit(1);
        if (rows.length > 0) return NextResponse.json({ entry: rows[0] });
      }
    }

    // Fan out over all Greek lexicon DBs for the fallback.
    for (const { db } of getLexiconDbsForLanguage("greek")) {
      const rows = await db
        .select()
        .from(lexiconEntries)
        .where(eq(lexiconEntries.lemma, lemma))
        .limit(1);
      if (rows.length > 0) return NextResponse.json({ entry: rows[0] });
    }

    return NextResponse.json({ entry: null });
  }

  // ── Strong-number-based lookup (Hebrew) ───────────────────────────────────
  const primary = strong!.split(/[/,\s]/)[0].trim();

  if (source) {
    const db = getLexiconDbForSource(source);
    if (db) {
      const rows = await db
        .select()
        .from(lexiconEntries)
        .where(and(eq(lexiconEntries.strongNumber, primary), eq(lexiconEntries.source, source)))
        .limit(1);
      if (rows.length > 0) return NextResponse.json({ entry: rows[0] });
    }
  }

  // Fan out over all Hebrew lexicon DBs.
  for (const { db } of getLexiconDbsForLanguage("hebrew")) {
    const rows = await db
      .select()
      .from(lexiconEntries)
      .where(eq(lexiconEntries.strongNumber, primary))
      .limit(1);
    if (rows.length > 0) return NextResponse.json({ entry: rows[0] });
  }

  return NextResponse.json({ entry: null });
}
