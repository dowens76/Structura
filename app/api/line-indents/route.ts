import { NextRequest, NextResponse } from "next/server";
import { getChapterLineIndents, setLineIndent } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

// GET /api/line-indents?book=Gen&chapter=1
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const book = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") ?? "", 10);

  if (!book || isNaN(chapter)) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const indents = await getChapterLineIndents(book, chapter, workspaceId);
  return NextResponse.json({ indents });
}

// POST /api/line-indents
// Body: { wordId, indentLevel, textSource, book, chapter }
// indentLevel = 0 removes the record (resets to no indent).
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { wordId?: string; indentLevel?: number; textSource?: string; book?: string; chapter?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { wordId, indentLevel, textSource, book, chapter } = body;
  if (!wordId || indentLevel == null || !textSource || !book || chapter == null) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  await setLineIndent(wordId, indentLevel, textSource, book, chapter, workspaceId);
  return NextResponse.json({ ok: true });
}
