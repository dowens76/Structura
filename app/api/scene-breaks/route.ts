import { NextRequest, NextResponse } from "next/server";
import {
  getChapterSceneBreaks,
  toggleSceneBreak,
  deleteSceneBreak,
  updateSceneBreakHeading,
  updateSceneBreakOutOfSequence,
  updateSceneBreakExtendedThrough,
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

// GET /api/scene-breaks?book=Gen&chapter=1
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const book    = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") ?? "", 10);

  if (!book || isNaN(chapter)) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const rows = await getChapterSceneBreaks(book, chapter, workspaceId);
  return NextResponse.json({ sceneBreaks: rows });
}

// POST /api/scene-breaks
// Body: { wordId, book, chapter, verse, source, level }
// Toggles a section break (and its implied paragraph break) for a (wordId, level) pair.
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { wordId?: string; book?: string; chapter?: number; verse?: number; source?: string; level?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { wordId, book, chapter, verse, source, level } = body;
  if (!wordId || !book || chapter == null || verse == null || !source) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const result = await toggleSceneBreak(wordId, book, chapter, verse, source, level ?? 1, workspaceId);
  return NextResponse.json(result);
}

// PATCH /api/scene-breaks
// Body: { wordId, level, heading? } | { wordId, level, outOfSequence? } | { wordId, level, extendedThrough? }
// Updates heading, outOfSequence, and/or extendedThrough for a specific (wordId, level) break.
// Level is required to identify which break to update.
export async function PATCH(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { wordId?: string; level?: number; heading?: string | null; outOfSequence?: boolean; extendedThrough?: number | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { wordId, level, heading, outOfSequence, extendedThrough } = body;
  if (!wordId || level == null) {
    return NextResponse.json({ error: "Missing wordId or level" }, { status: 400 });
  }

  if (heading !== undefined) {
    await updateSceneBreakHeading(wordId, level, heading ?? null, workspaceId);
  }
  if (outOfSequence !== undefined) {
    await updateSceneBreakOutOfSequence(wordId, level, outOfSequence, workspaceId);
  }
  if (extendedThrough !== undefined) {
    await updateSceneBreakExtendedThrough(wordId, level, extendedThrough, workspaceId);
  }
  return new NextResponse(null, { status: 204 });
}

// DELETE /api/scene-breaks
// Body: { wordId, level }
// Deletes a specific (wordId, level) section break; removes paragraph break if no others remain.
export async function DELETE(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { wordId?: string; level?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { wordId, level } = body;
  if (!wordId || level == null) {
    return NextResponse.json({ error: "Missing wordId or level" }, { status: 400 });
  }

  await deleteSceneBreak(wordId, level, workspaceId);
  return new NextResponse(null, { status: 204 });
}
