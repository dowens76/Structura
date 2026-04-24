import { NextRequest, NextResponse } from "next/server";
import { getChapterMaxVerse } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

// GET /api/verse-count?book=Gen&chapter=1&source=OSHB
// Returns the highest verse number in the given chapter, useful for passage boundary navigation.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const book    = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") ?? "", 10);
  const source  = searchParams.get("source");

  if (!book || isNaN(chapter) || !source) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const maxVerse = await getChapterMaxVerse(book, chapter, source);
  return NextResponse.json({ maxVerse });
}
