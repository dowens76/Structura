import { NextRequest, NextResponse } from "next/server";
import { getChapterWords } from "@/lib/db/queries";
import type { TextSource } from "@/lib/morphology/types";

export const dynamic = "force-dynamic";

const VALID_SOURCES = new Set<TextSource>(["OSHB", "SBLGNT", "STEPBIBLE_LXX"]);

// GET /api/passage-preview?book=Heb&chapter=5&verse=4&source=SBLGNT
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const book = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") ?? "", 10);
  const verse = parseInt(searchParams.get("verse") ?? "", 10);
  const source = searchParams.get("source") as TextSource | null;

  if (!book || !source || !VALID_SOURCES.has(source) || !Number.isFinite(chapter) || !Number.isFinite(verse)) {
    return NextResponse.json({ words: [] }, { status: 400 });
  }

  const chapterWords = await getChapterWords(book, chapter, source);
  const words = chapterWords.filter((w) => w.verse === verse);
  return NextResponse.json({ words });
}
