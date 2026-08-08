import { NextRequest, NextResponse } from "next/server";
import { getChapterCharacterRefs, upsertCharacterRef, removeCharacterRef } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { getActiveVersionId } from "@/lib/versions/activeVersion";

export const dynamic = "force-dynamic";

// GET /api/character-refs?book=Gen&chapter=1
// Returns refs for ALL text sources in this chapter (source text + translations)
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const book = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") ?? "", 10);

  if (!book || isNaN(chapter)) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  const refs = await getChapterCharacterRefs(book, chapter, workspaceId, versionId);
  return NextResponse.json({ refs });
}

// POST /api/character-refs
// Body: { wordId, character1Id, character2Id|null, book, chapter, source }
// If character1Id is null → remove the ref entirely
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: {
    wordId?: string;
    character1Id?: number | null;
    character2Id?: number | null;
    book?: string;
    chapter?: number;
    source?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { wordId, character1Id, character2Id, book, chapter, source } = body;
  if (!wordId || chapter == null || !book || !source) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  if (character1Id == null) {
    await removeCharacterRef(wordId, workspaceId, versionId);
  } else {
    await upsertCharacterRef(wordId, character1Id, character2Id ?? null, book, chapter, source, workspaceId, versionId);
  }

  return NextResponse.json({ ok: true });
}
