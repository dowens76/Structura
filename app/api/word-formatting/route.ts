import { NextRequest, NextResponse } from "next/server";
import { getChapterWordFormatting, setWordFormatting } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { getActiveVersionId } from "@/lib/versions/activeVersion";

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

  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  const formatting = await getChapterWordFormatting(book, chapter, workspaceId, versionId);
  return NextResponse.json({ formatting });
}

// POST /api/word-formatting
// Body: { wordId, isBold, isItalic, textColor, letterColors, textSource, book, chapter }
// If isBold and isItalic are both false, textColor is null/omitted, and
// letterColors is null/empty, the record is removed (resets to no formatting).
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { wordId?: string; isBold?: boolean; isItalic?: boolean; textColor?: string | null; letterColors?: Record<number, string> | null; textSource?: string; book?: string; chapter?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { wordId, isBold, isItalic, textColor, letterColors, textSource, book, chapter } = body;
  if (!wordId || isBold == null || isItalic == null || !textSource || !book || chapter == null) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  await setWordFormatting(wordId, isBold, isItalic, textColor ?? null, letterColors ?? null, textSource, book, chapter, workspaceId, versionId);
  return NextResponse.json({ ok: true });
}
