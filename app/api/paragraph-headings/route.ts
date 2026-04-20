import { NextRequest, NextResponse } from "next/server";
import { getChapterParagraphHeadings, setParagraphHeading } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

// GET /api/paragraph-headings?book=Gen&chapter=1
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const book = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") ?? "", 10);

  if (!book || isNaN(chapter)) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const headings = await getChapterParagraphHeadings(book, chapter, workspaceId);
  return NextResponse.json({ headings });
}

// POST /api/paragraph-headings
// Body: { book, chapter, verse, heading } — empty heading deletes the row
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { book?: string; chapter?: number; verse?: number; heading?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { book, chapter, verse, heading } = body;
  if (!book || chapter == null || verse == null || heading == null) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  await setParagraphHeading(book, chapter, verse, heading, workspaceId);
  return NextResponse.json({ ok: true });
}
