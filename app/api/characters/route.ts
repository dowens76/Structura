import { NextRequest, NextResponse } from "next/server";
import { getCharacters, createCharacter, getWordRefsByLemmas, bulkInsertCharacterRefs } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { canonicalPairBook } from "@/lib/utils/osis";

export const dynamic = "force-dynamic";

// GET /api/characters?book=Gen
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const book = searchParams.get("book");
  if (!book) {
    return NextResponse.json({ error: "Missing book param" }, { status: 400 });
  }
  const chars = await getCharacters(book, workspaceId);
  return NextResponse.json({ characters: chars });
}

// POST /api/characters  body: { name, color, book, lemmas?, corpusType?, corpusGroupingId?, corpusChapter?, corpusPassageId?, corpusBooks?, textSource?, currentChapter? }
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: {
    name?: string; color?: string; book?: string;
    lemmas?: string[] | null;
    corpusType?: string; corpusGroupingId?: number | null; corpusChapter?: number | null; corpusPassageId?: number | null;
    corpusBooks?: string[]; textSource?: string; currentChapter?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, color, book, lemmas, corpusType, corpusGroupingId, corpusChapter, corpusPassageId, corpusBooks, textSource, currentChapter } = body;
  if (!name || !color || !book) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Store under the canonical (first) book of a contiguous pair so characters
  // are shared across both halves (e.g. 1Sam and 2Sam share the same pool).
  const canonicalBook = canonicalPairBook(book);
  const character = await createCharacter(name, color, canonicalBook, workspaceId, lemmas, {
    corpusType, corpusGroupingId, corpusChapter, corpusPassageId,
  });

  let chapterRefs: Array<{ wordId: string; book: string; chapter: number; textSource: string }> = [];
  if (lemmas?.length && corpusBooks?.length && textSource) {
    const allRefs = await getWordRefsByLemmas(lemmas, corpusBooks, textSource);
    await bulkInsertCharacterRefs(character.id, allRefs, workspaceId);
    if (currentChapter != null) {
      chapterRefs = allRefs.filter((r) => r.book === book && r.chapter === currentChapter);
    }
  }

  return NextResponse.json({ character, chapterRefs });
}
