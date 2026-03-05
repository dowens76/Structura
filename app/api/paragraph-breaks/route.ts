import { NextRequest, NextResponse } from "next/server";
import { getChapterParagraphBreaks, toggleParagraphBreak } from "@/lib/db/queries";

// GET /api/paragraph-breaks?book=Gen&chapter=1
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const book = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") ?? "", 10);

  if (!book || isNaN(chapter)) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const wordIds = await getChapterParagraphBreaks(book, chapter);
  return NextResponse.json({ wordIds });
}

// POST /api/paragraph-breaks
// Body: { wordId, book, chapter, source }
export async function POST(request: NextRequest) {
  let body: { wordId?: string; book?: string; chapter?: number; source?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { wordId, book, chapter, source } = body;
  if (!wordId || !book || chapter == null || !source) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const result = await toggleParagraphBreak(wordId, book, chapter, source);
  return NextResponse.json(result);
}
