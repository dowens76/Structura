import { NextRequest, NextResponse } from "next/server";
import { upsertWordTagRef, removeWordTagRef } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { getActiveVersionId } from "@/lib/versions/activeVersion";

export const dynamic = "force-dynamic";

// POST /api/word-tag-refs
// body: { wordId, tagId, book, chapter, source }
// If tagId is null → remove the ref
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: {
    wordId?: string;
    tagId?: number | null;
    book?: string;
    chapter?: number;
    source?: string;
  };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { wordId, tagId, book, chapter, source } = body;
  if (!wordId || chapter == null || !book || !source) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  if (tagId == null) {
    await removeWordTagRef(wordId, workspaceId, versionId);
  } else {
    await upsertWordTagRef(wordId, tagId, source, book, chapter, workspaceId, versionId);
  }
  return NextResponse.json({ ok: true });
}
