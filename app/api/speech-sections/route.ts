import { NextRequest, NextResponse } from "next/server";
import {
  getChapterSpeechSections,
  upsertSpeechSection,
  removeSpeechSectionContaining,
  replaceChapterSpeechSections,
  updateSpeechSectionCharacter,
  getChapterWords,
} from "@/lib/db/queries";
import type { SpeechSection } from "@/lib/db/schema";
import type { TextSource } from "@/lib/morphology/types";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// GET /api/speech-sections?book=Gen&chapter=1&source=OSHB
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const book = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") ?? "", 10);
  const source = searchParams.get("source");

  if (!book || isNaN(chapter) || !source) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const sections = await getChapterSpeechSections(book, chapter, source, workspaceId);
  return NextResponse.json({ sections });
}

// POST /api/speech-sections
// Body: { characterId, startWordId, endWordId, book, chapter, source }
// Returns updated full section list for the chapter
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: {
    characterId?: number;
    startWordId?: string;
    endWordId?: string;
    book?: string;
    chapter?: number;
    source?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { characterId, startWordId, endWordId, book, chapter, source } = body;
  if (!characterId || !startWordId || !endWordId || !book || chapter == null || !source) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const chapterWords = await getChapterWords(book, chapter, source as TextSource);
  const sections = await upsertSpeechSection(
    characterId, startWordId, endWordId, book, chapter, source, chapterWords, workspaceId
  );
  return NextResponse.json({ sections });
}

// PUT /api/speech-sections — replace the full section list for a chapter (used by undo)
// Body: { book, chapter, source, sections }
export async function PUT(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: {
    book?: string;
    chapter?: number;
    source?: string;
    sections?: SpeechSection[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { book, chapter, source, sections } = body;
  if (!book || chapter == null || !source || !Array.isArray(sections)) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  await replaceChapterSpeechSections(book, chapter, source, sections, workspaceId);
  const updated = await getChapterSpeechSections(book, chapter, source, workspaceId);
  return NextResponse.json({ sections: updated });
}

// PATCH /api/speech-sections
// Body: { sectionId, characterId, book, chapter, source }
// Reassigns an existing speech section to a different character.
export async function PATCH(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { sectionId?: number; characterId?: number; book?: string; chapter?: number; source?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sectionId, characterId, book, chapter, source } = body;
  if (!sectionId || !characterId || !book || chapter == null || !source) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const sections = await updateSpeechSectionCharacter(sectionId, characterId, book, chapter, source, workspaceId);
  return NextResponse.json({ sections });
}

// DELETE /api/speech-sections
// Body: { wordId, book, chapter, source }
// Returns updated full section list for the chapter
export async function DELETE(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: {
    wordId?: string;
    book?: string;
    chapter?: number;
    source?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { wordId, book, chapter, source } = body;
  if (!wordId || !book || chapter == null || !source) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const chapterWords = await getChapterWords(book, chapter, source as TextSource);
  const sections = await removeSpeechSectionContaining(wordId, book, chapter, source, chapterWords, workspaceId);
  return NextResponse.json({ sections });
}
