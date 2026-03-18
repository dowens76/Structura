import { NextRequest, NextResponse } from "next/server";
import {
  getChapterSceneBreaks,
  toggleSceneBreak,
  updateSceneBreakHeading,
  updateSceneBreakOutOfSequence,
} from "@/lib/db/queries";

// GET /api/scene-breaks?book=Gen&chapter=1
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const book    = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") ?? "", 10);

  if (!book || isNaN(chapter)) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const rows = await getChapterSceneBreaks(book, chapter);
  return NextResponse.json({ sceneBreaks: rows });
}

// POST /api/scene-breaks
// Body: { wordId, book, chapter, source }
// Toggles a scene break (and its implied paragraph break) for a word.
export async function POST(request: NextRequest) {
  let body: { wordId?: string; book?: string; chapter?: number; source?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { wordId, book, chapter, source } = body;
  if (!wordId || !book || chapter == null || !source) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const result = await toggleSceneBreak(wordId, book, chapter, source);
  return NextResponse.json(result);
}

// PATCH /api/scene-breaks
// Body: { wordId, heading? } | { wordId, outOfSequence? }
// Updates the heading and/or outOfSequence flag for an existing scene break.
export async function PATCH(request: NextRequest) {
  let body: { wordId?: string; heading?: string | null; outOfSequence?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { wordId, heading, outOfSequence } = body;
  if (!wordId) {
    return NextResponse.json({ error: "Missing wordId" }, { status: 400 });
  }

  if (heading !== undefined) {
    await updateSceneBreakHeading(wordId, heading ?? null);
  }
  if (outOfSequence !== undefined) {
    await updateSceneBreakOutOfSequence(wordId, outOfSequence);
  }
  return new NextResponse(null, { status: 204 });
}
