import { NextRequest, NextResponse } from "next/server";
import {
  deleteCharacter, updateCharacter,
  deleteCharacterRefsByCharacterId, getWordRefsByLemmas, bulkInsertCharacterRefs,
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// PATCH /api/characters/:id  body: { name, color, lemmas?, prevLemmas?, corpusType?, corpusGroupingId?, corpusChapter?, corpusPassageId?, corpusBooks?, textSource?, currentChapter?, book? }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  let body: {
    name?: string; color?: string;
    lemmas?: string[] | null; prevLemmas?: string[] | null;
    corpusType?: string; corpusGroupingId?: number | null; corpusChapter?: number | null; corpusPassageId?: number | null;
    corpusBooks?: string[]; textSource?: string; currentChapter?: number; book?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { name, color, lemmas, prevLemmas, corpusType, corpusGroupingId, corpusChapter, corpusPassageId, corpusBooks, textSource, currentChapter, book } = body;
  if (!name || !color) {
    return NextResponse.json({ error: "Missing name or color" }, { status: 400 });
  }
  const character = await updateCharacter(numId, name, color, lemmas, {
    corpusType, corpusGroupingId, corpusChapter, corpusPassageId,
  });

  // Re-run lemma search when lemmas changed
  const lemmasChanged = lemmas !== undefined && JSON.stringify(lemmas ?? []) !== JSON.stringify(prevLemmas ?? []);
  let chapterRefs: Array<{ wordId: string; book: string; chapter: number; textSource: string }> = [];

  if (lemmasChanged && lemmas?.length && corpusBooks?.length && textSource) {
    const workspaceId = await getActiveWorkspaceId();
    await deleteCharacterRefsByCharacterId(numId);
    const allRefs = await getWordRefsByLemmas(lemmas, corpusBooks, textSource);
    await bulkInsertCharacterRefs(numId, allRefs, workspaceId);
    if (currentChapter != null && book) {
      chapterRefs = allRefs.filter((r) => r.book === book && r.chapter === currentChapter);
    }
  }

  return NextResponse.json({ character, chapterRefs });
}

// DELETE /api/characters/:id
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  await deleteCharacter(numId);
  return NextResponse.json({ ok: true });
}
