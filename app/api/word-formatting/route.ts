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
// Body: { wordId, isBold, isItalic, isUnderline, textColor, letterColors, letterBold, letterItalic, letterUnderline, textSource, book, chapter }
// If isBold, isItalic, and isUnderline are all false, textColor is null/omitted,
// and every letter-level field is null/empty, the record is removed (resets to no formatting).
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: {
    wordId?: string;
    isBold?: boolean;
    isItalic?: boolean;
    isUnderline?: boolean;
    textColor?: string | null;
    letterColors?: Record<number, string> | null;
    letterBold?: number[] | null;
    letterItalic?: number[] | null;
    letterUnderline?: number[] | null;
    textSource?: string;
    book?: string;
    chapter?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { wordId, isBold, isItalic, isUnderline, textColor, letterColors, letterBold, letterItalic, letterUnderline, textSource, book, chapter } = body;
  if (!wordId || isBold == null || isItalic == null || isUnderline == null || !textSource || !book || chapter == null) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  await setWordFormatting(
    wordId, isBold, isItalic, isUnderline, textColor ?? null,
    letterColors ?? null, letterBold ?? null, letterItalic ?? null, letterUnderline ?? null,
    textSource, book, chapter, workspaceId, versionId
  );
  return NextResponse.json({ ok: true });
}
