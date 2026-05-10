import { NextRequest, NextResponse } from "next/server";
import { getPassagesForBook, createPassage } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// GET /api/passages?book=Gen&source=OSHB
// GET /api/passages?book=1Sam&book2=2Sam&source=OSHB  ← cross-book pair
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const book   = searchParams.get("book");
  const book2  = searchParams.get("book2");
  const source = searchParams.get("source");

  if (!book || !source) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const books = book2 ? [book, book2] : book;
  const list = await getPassagesForBook(books, source, workspaceId);
  return NextResponse.json({ passages: list });
}

/**
 * POST /api/passages
 * Body: { book, textSource, label, startChapter, startVerse, endBook?, endChapter, endVerse }
 * endBook is optional; when omitted (or equal to book) the passage is single-book.
 */
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: {
    book?: string;
    textSource?: string;
    label?: string;
    startChapter?: number;
    startVerse?: number;
    endBook?: string | null;
    endChapter?: number;
    endVerse?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { book, textSource, label, startChapter, startVerse, endBook, endChapter, endVerse } = body;
  if (
    !book || !textSource || label == null ||
    startChapter == null || startVerse == null ||
    endChapter == null || endVerse == null
  ) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const isCrossBook = endBook && endBook !== book;

  // For single-book passages validate ordering by chapter/verse.
  // For cross-book passages the end is always after the start by definition.
  if (!isCrossBook && (
    startChapter > endChapter ||
    (startChapter === endChapter && startVerse > endVerse)
  )) {
    return NextResponse.json({ error: "Start must not be after end" }, { status: 400 });
  }

  const passage = await createPassage(
    book, textSource, label,
    startChapter, startVerse,
    endBook ?? null,
    endChapter, endVerse,
    workspaceId
  );
  return NextResponse.json({ passage }, { status: 201 });
}
