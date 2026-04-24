import { NextRequest, NextResponse } from "next/server";
import { getChapterParagraphBreaks, toggleParagraphBreak } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// GET /api/paragraph-breaks?book=Gen&chapter=1
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const book = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") ?? "", 10);

  if (!book || isNaN(chapter)) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const wordIds = await getChapterParagraphBreaks(book, chapter, workspaceId);
  return NextResponse.json({ wordIds });
}

// POST /api/paragraph-breaks
// Body: { wordId, book, chapter, source }
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
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

  const result = await toggleParagraphBreak(wordId, book, chapter, source, workspaceId);
  return NextResponse.json(result);
}
