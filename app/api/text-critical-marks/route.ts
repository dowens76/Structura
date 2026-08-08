import { NextRequest, NextResponse } from "next/server";
import { getChapterTextCriticalMarks, upsertTextCriticalMark, deleteTextCriticalMark } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { getActiveVersionId } from "@/lib/versions/activeVersion";

export const dynamic = "force-dynamic";

// GET /api/text-critical-marks?book=Gen&chapter=1
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const book    = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") ?? "", 10);

  if (!book || isNaN(chapter)) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  const marks = getChapterTextCriticalMarks(book, chapter, workspaceId, versionId);
  return NextResponse.json({ marks });
}

// POST /api/text-critical-marks
// Body: { wordId, markType, textSource, book, chapter }
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { wordId?: string; markType?: string; textSource?: string; book?: string; chapter?: number };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { wordId, markType, textSource, book, chapter } = body;
  if (!wordId || !markType || !textSource || !book || chapter == null) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  await upsertTextCriticalMark(wordId, markType, textSource, book, chapter, workspaceId, versionId);
  return NextResponse.json({ ok: true });
}

// DELETE /api/text-critical-marks
// Body: { wordId, book, chapter }
export async function DELETE(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { wordId?: string; book?: string; chapter?: number };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { wordId, book, chapter } = body;
  if (!wordId || !book || chapter == null) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  await deleteTextCriticalMark(wordId, workspaceId, versionId);
  return NextResponse.json({ ok: true });
}
