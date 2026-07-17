import { NextRequest, NextResponse } from "next/server";
import { resolveVocabularyList, type VocabScopeParams } from "@/lib/vocabulary/resolve";

export const dynamic = "force-dynamic";

const VALID_TEXT_SOURCES = new Set(["OSHB", "SBLGNT", "STEPBIBLE_LXX"]);

// POST body: VocabScopeParams (see lib/vocabulary/resolve.ts)
// Returns: { words: VocabWord[], count: number }
export async function POST(request: NextRequest) {
  let body: Partial<VocabScopeParams>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { textSource, osisBooks, chapterStart, chapterEnd, minOccurrences, maxOccurrences } = body;

  if (!textSource || !VALID_TEXT_SOURCES.has(textSource)) {
    return NextResponse.json({ error: "Missing or invalid textSource" }, { status: 400 });
  }
  if (!Array.isArray(osisBooks) || osisBooks.length === 0) {
    return NextResponse.json({ error: "osisBooks must be a non-empty array" }, { status: 400 });
  }
  if ((chapterStart != null || chapterEnd != null) && osisBooks.length !== 1) {
    return NextResponse.json({ error: "chapterStart/chapterEnd are only valid when osisBooks has exactly one book" }, { status: 400 });
  }
  const min = typeof minOccurrences === "number" && minOccurrences >= 0 ? minOccurrences : 1;
  const max = typeof maxOccurrences === "number" && maxOccurrences >= 0 ? maxOccurrences : null;

  const words = await resolveVocabularyList({
    textSource,
    osisBooks,
    chapterStart: chapterStart ?? undefined,
    chapterEnd: chapterEnd ?? undefined,
    minOccurrences: min,
    maxOccurrences: max,
  });

  return NextResponse.json({ words, count: words.length });
}
