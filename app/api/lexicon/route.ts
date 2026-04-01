import { NextRequest, NextResponse } from "next/server";
import { lexicaDb } from "@/lib/db";
import { lexiconEntries } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// GET /api/lexicon?strong=H7225&source=BDB
// GET /api/lexicon?strong=G2316&source=AbbottSmith
//
// If `source` is provided, returns that source's entry for the strong number.
// Falls back to any available entry if the preferred source has no entry.
// If `source` is omitted, returns the first available entry.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const strong = searchParams.get("strong")?.trim();
  const source = searchParams.get("source")?.trim() ?? null;

  if (!strong || !lexicaDb) {
    return NextResponse.json({ entry: null });
  }

  // Try preferred source first
  if (source) {
    const preferred = await lexicaDb
      .select()
      .from(lexiconEntries)
      .where(and(eq(lexiconEntries.strongNumber, strong), eq(lexiconEntries.source, source)))
      .limit(1);

    if (preferred.length > 0) {
      return NextResponse.json({ entry: preferred[0] });
    }
  }

  // Fallback: any entry for this strong number
  const results = await lexicaDb
    .select()
    .from(lexiconEntries)
    .where(eq(lexiconEntries.strongNumber, strong))
    .limit(1);

  return NextResponse.json({ entry: results[0] ?? null });
}
