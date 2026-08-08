import { NextRequest, NextResponse } from "next/server";
import {
  getChapterSceneBreaks,
  toggleSceneBreak,
  deleteSceneBreak,
  updateSceneBreakHeading,
  updateSceneBreakOutOfSequence,
  updateSceneBreakExtendedThrough,
  updateSceneBreakThematic,
  updateSceneBreakTransitional,
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { getActiveVersionId } from "@/lib/versions/activeVersion";

export const dynamic = "force-dynamic";

// GET /api/scene-breaks?book=Gen&chapter=1
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const book    = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") ?? "", 10);

  if (!book || isNaN(chapter)) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  const rows = await getChapterSceneBreaks(book, chapter, workspaceId, versionId);
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

  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  const result = await toggleSceneBreak(wordId, book, chapter, verse, source, level ?? 1, workspaceId, versionId);
  return NextResponse.json(result);
}

// PATCH /api/scene-breaks
// Body: { wordId, book, chapter, level, heading? } | { ..., outOfSequence? } | { ..., extendedThrough? }
// Updates heading, outOfSequence, and/or extendedThrough for a specific (wordId, level) break.
// Level is required to identify which break to update. book/chapter resolve the active version.
export async function PATCH(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { wordId?: string; book?: string; chapter?: number; level?: number; heading?: string | null; outOfSequence?: boolean; extendedThrough?: number | null; thematic?: boolean; thematicLetter?: string | null; transitional?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { wordId, book, chapter, level, heading, outOfSequence, extendedThrough, thematic, thematicLetter, transitional } = body;
  if (!wordId || level == null || !book || chapter == null) {
    return NextResponse.json({ error: "Missing wordId, level, book, or chapter" }, { status: 400 });
  }

  const versionId = await getActiveVersionId(workspaceId, book, chapter);

  if (heading !== undefined) {
    await updateSceneBreakHeading(wordId, level, heading ?? null, workspaceId, versionId);
  }
  if (outOfSequence !== undefined) {
    await updateSceneBreakOutOfSequence(wordId, level, outOfSequence, workspaceId, versionId);
  }
  if (extendedThrough !== undefined) {
    await updateSceneBreakExtendedThrough(wordId, level, extendedThrough, workspaceId, versionId);
  }
  if (thematic !== undefined) {
    await updateSceneBreakThematic(wordId, level, thematic, thematicLetter ?? null, workspaceId, versionId);
  }
  if (transitional !== undefined) {
    await updateSceneBreakTransitional(wordId, level, transitional, workspaceId, versionId);
  }
  return new NextResponse(null, { status: 204 });
}

// DELETE /api/scene-breaks
// Body: { wordId, book, chapter, level }
// Deletes a specific (wordId, level) section break; removes paragraph break if no others remain.
export async function DELETE(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { wordId?: string; book?: string; chapter?: number; level?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { wordId, book, chapter, level } = body;
  if (!wordId || level == null || !book || chapter == null) {
    return NextResponse.json({ error: "Missing wordId, level, book, or chapter" }, { status: 400 });
  }

  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  await deleteSceneBreak(wordId, level, workspaceId, versionId);
  return new NextResponse(null, { status: 204 });
}
