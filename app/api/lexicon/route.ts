import { NextRequest, NextResponse } from "next/server";
import { lexicaDb } from "@/lib/db";
import { lexiconEntries } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

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

  if ((!lemma && !strong) || !lexicaDb) {
    return NextResponse.json({ entry: null });
  }

  // ── Lemma-based lookup (Greek) ────────────────────────────────────────────
  if (lemma) {
    if (source) {
      const preferred = await lexicaDb
        .select()
        .from(lexiconEntries)
        .where(and(eq(lexiconEntries.lemma, lemma), eq(lexiconEntries.source, source)))
        .limit(1);
      if (preferred.length > 0) return NextResponse.json({ entry: preferred[0] });
    }
    const fallback = await lexicaDb
      .select()
      .from(lexiconEntries)
      .where(eq(lexiconEntries.lemma, lemma))
      .limit(1);
    return NextResponse.json({ entry: fallback[0] ?? null });
  }

  // ── Strong-number-based lookup (Hebrew) ───────────────────────────────────
  const primary = strong!.split(/[/,\s]/)[0].trim();

  if (source) {
    const preferred = await lexicaDb
      .select()
      .from(lexiconEntries)
      .where(and(eq(lexiconEntries.strongNumber, primary), eq(lexiconEntries.source, source)))
      .limit(1);
    if (preferred.length > 0) return NextResponse.json({ entry: preferred[0] });
  }

  const results = await lexicaDb
    .select()
    .from(lexiconEntries)
    .where(eq(lexiconEntries.strongNumber, primary))
    .limit(1);
  return NextResponse.json({ entry: results[0] ?? null });
}
