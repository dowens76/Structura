import { NextRequest, NextResponse } from "next/server";
import { getChapterSyllableStressOverrides, setSyllableStressOverride, deleteSyllableStressOverride } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { getActiveVersionId } from "@/lib/versions/activeVersion";

export const dynamic = "force-dynamic";

// GET /api/syllable-stress-overrides?book=Gen&chapter=1
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const book = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") ?? "", 10);

  if (!book || isNaN(chapter)) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  const overrides = await getChapterSyllableStressOverrides(book, chapter, workspaceId, versionId);
  return NextResponse.json({ overrides });
}

// POST /api/syllable-stress-overrides
// Body: { wordId, stresses, syllables, textSource, book, chapter }
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { wordId?: string; stresses?: number; syllables?: number; textSource?: string; book?: string; chapter?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { wordId, stresses, syllables, textSource, book, chapter } = body;
  if (!wordId || stresses == null || syllables == null || !textSource || !book || chapter == null) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  await setSyllableStressOverride(wordId, Math.max(0, stresses), Math.max(0, syllables), textSource, book, chapter, workspaceId, versionId);
  return NextResponse.json({ ok: true });
}

// DELETE /api/syllable-stress-overrides
// Body: { wordId, book, chapter }
// Reverts the line back to the computed heuristic count.
export async function DELETE(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { wordId?: string; book?: string; chapter?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { wordId, book, chapter } = body;
  if (!wordId || !book || chapter == null) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  await deleteSyllableStressOverride(wordId, workspaceId, versionId);
  return new NextResponse(null, { status: 204 });
}
