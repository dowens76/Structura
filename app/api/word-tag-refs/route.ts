import { NextRequest, NextResponse } from "next/server";
import { upsertWordTagRef, removeWordTagRef } from "@/lib/db/queries";

// POST /api/word-tag-refs
// body: { wordId, tagId, book, chapter, source }
// If tagId is null → remove the ref
export async function POST(request: NextRequest) {
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
  if (tagId == null) {
    await removeWordTagRef(wordId);
  } else {
    await upsertWordTagRef(wordId, tagId, source, book, chapter);
  }
  return NextResponse.json({ ok: true });
}
