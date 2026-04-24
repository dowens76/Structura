import { NextRequest, NextResponse } from "next/server";
import { getChapterWordFormatting, setWordFormatting } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// GET /api/word-formatting?book=Gen&chapter=1
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const book = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") ?? "", 10);

  if (!book || isNaN(chapter)) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const formatting = await getChapterWordFormatting(book, chapter, workspaceId);
  return NextResponse.json({ formatting });
}

// POST /api/word-formatting
// Body: { wordId, isBold, isItalic, textSource, book, chapter }
// If both isBold and isItalic are false, the record is removed (resets to no formatting).
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { wordId?: string; isBold?: boolean; isItalic?: boolean; textSource?: string; book?: string; chapter?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { wordId, isBold, isItalic, textSource, book, chapter } = body;
  if (!wordId || isBold == null || isItalic == null || !textSource || !book || chapter == null) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  await setWordFormatting(wordId, isBold, isItalic, textSource, book, chapter, workspaceId);
  return NextResponse.json({ ok: true });
}
