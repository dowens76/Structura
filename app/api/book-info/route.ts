import { NextRequest, NextResponse } from "next/server";
import { getMaxChapterForSource, getBookChapterMaxVerses } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/book-info?book=2Sam&source=OSHB
 * Returns the effective chapter count and per-chapter max-verse map for the
 * given book + source combination.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const book   = searchParams.get("book");
  const source = searchParams.get("source");

  if (!book || !source) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const [chapterCount, chapterMaxVersesMap] = await Promise.all([
    getMaxChapterForSource(book, source),
    getBookChapterMaxVerses(book, source),
  ]);

  // Serialize Map → plain object for JSON
  const chapterMaxVerses: Record<number, number> = {};
  for (const [ch, mv] of chapterMaxVersesMap) {
    chapterMaxVerses[ch] = mv;
  }

  return NextResponse.json({ chapterCount, chapterMaxVerses });
}
