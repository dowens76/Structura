import { NextRequest, NextResponse } from "next/server";
import { updateWordTag, deleteWordTag, deleteWordTagRefsByTagId, getWordRefsByLemmas, bulkInsertWordTagRefs } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// PATCH /api/word-tags/:id  body: { name, color, corpusGroupingId?, lemmas?, corpusBooks?, textSource?, currentChapter?, book? }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  let body: {
    name?: string;
    color?: string;
    corpusGroupingId?: number | null;
    lemmas?: string[] | null;
    prevLemmas?: string[] | null;
    corpusBooks?: string[];
    textSource?: string;
    currentChapter?: number;
    book?: string;
    corpusType?: string;
    corpusChapter?: number | null;
    corpusPassageId?: number | null;
  };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { name, color, corpusGroupingId, lemmas, prevLemmas, corpusBooks, textSource, currentChapter, book, corpusType, corpusChapter, corpusPassageId } = body;
  if (!name || !color) return NextResponse.json({ error: "Missing name or color" }, { status: 400 });

  const tag = await updateWordTag(numId, name, color, corpusGroupingId, lemmas, {
    corpusType, corpusGroupingId, corpusChapter, corpusPassageId,
  });

  // Re-run lemma search when lemmas changed on a cluster/word tag
  const lemmasChanged = lemmas !== undefined && JSON.stringify(lemmas ?? []) !== JSON.stringify(prevLemmas ?? []);
  let chapterRefs: Array<{ wordId: string; book: string; chapter: number; textSource: string }> = [];

  if (lemmasChanged && lemmas?.length && corpusBooks?.length && textSource) {
    const workspaceId = await getActiveWorkspaceId();
    await deleteWordTagRefsByTagId(numId);
    const allRefs = await getWordRefsByLemmas(lemmas, corpusBooks, textSource);
    await bulkInsertWordTagRefs(numId, allRefs, workspaceId);
    if (currentChapter != null && book) {
      chapterRefs = allRefs.filter((r) => r.book === book && r.chapter === currentChapter);
    }
  }

  return NextResponse.json({ tag, chapterRefs });
}

// DELETE /api/word-tags/:id
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  await deleteWordTag(numId);
  return NextResponse.json({ ok: true });
}
