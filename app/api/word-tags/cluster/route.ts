import { NextRequest, NextResponse } from "next/server";
import { createWordTag, getWordRefsByLemmas, bulkInsertWordTagRefs } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { canonicalPairBook } from "@/lib/utils/osis";

export const dynamic = "force-dynamic";

// POST /api/word-tags/cluster
// Body: { name, color, book, lemmas, corpusBooks, textSource, corpusGroupingId? }
// Creates a "cluster" tag and auto-tags all matching words in the corpus.
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();

  let body: {
    name?: string;
    color?: string;
    book?: string;
    lemmas?: string[];
    corpusBooks?: string[];
    textSource?: string;
    corpusGroupingId?: number | null;
    currentChapter?: number;
    type?: string;
    corpusType?: string;
    corpusChapter?: number | null;
    corpusPassageId?: number | null;
  };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, color, book, lemmas, corpusBooks, textSource, corpusGroupingId, currentChapter, corpusType, corpusChapter, corpusPassageId } = body;
  const tagType = body.type === "word" ? "word" : "cluster";
  if (!name || !color || !book || !lemmas?.length || !corpusBooks?.length || !textSource) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const canonicalBook = canonicalPairBook(book);
  const tag = await createWordTag(name, color, tagType, canonicalBook, workspaceId, corpusGroupingId, lemmas, {
    corpusType, corpusGroupingId, corpusChapter, corpusPassageId,
  });

  const allRefs = await getWordRefsByLemmas(lemmas, corpusBooks, textSource);
  const { inserted } = await bulkInsertWordTagRefs(tag.id, allRefs, workspaceId);

  // Return refs for the current chapter so the client can update local state immediately
  const chapterRefs = currentChapter != null
    ? allRefs.filter((r) => r.book === book && r.chapter === currentChapter)
    : [];

  return NextResponse.json({ tag, tagged: inserted, chapterRefs });
}
