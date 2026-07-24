import { NextRequest, NextResponse } from "next/server";
import { getWordTags, createWordTag } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { canonicalPairBook } from "@/lib/utils/osis";

export const dynamic = "force-dynamic";

// GET /api/word-tags?book=Gen
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const book = searchParams.get("book");
  if (!book) return NextResponse.json({ error: "Missing book param" }, { status: 400 });
  const tags = await getWordTags(book, workspaceId);
  return NextResponse.json({ tags });
}

// POST /api/word-tags  body: { name, color, type, book, corpusGroupingId?, lemmas?, corpusType?, corpusChapter?, corpusPassageId? }
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: {
    name?: string; color?: string; type?: string; book?: string;
    corpusGroupingId?: number | null; lemmas?: string[];
    corpusType?: string; corpusChapter?: number | null; corpusPassageId?: number | null;
  };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { name, color, type, book, corpusGroupingId, lemmas, corpusType, corpusChapter, corpusPassageId } = body;
  if (!name || !color || !type || !book) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  // Store under the canonical (first) book of a contiguous pair so word tags
  // are shared across both halves (e.g. 1Sam and 2Sam share the same pool).
  const canonicalBook = canonicalPairBook(book);
  const tag = await createWordTag(name, color, type, canonicalBook, workspaceId, corpusGroupingId, lemmas, {
    corpusType, corpusGroupingId, corpusChapter, corpusPassageId,
  });
  return NextResponse.json({ tag });
}
