import { NextRequest, NextResponse } from "next/server";
import { userSqlite } from "@/lib/db";

// ── GET /api/interlinear/constituent-labels ────────────────────────────────────
// Returns all constituent labels for a given chapter.
// Query params: workspaceId, book, chapter, textSource
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceId = parseInt(searchParams.get("workspaceId") ?? "1");
  const book        = searchParams.get("book");
  const chapter     = parseInt(searchParams.get("chapter") ?? "0");
  const textSource  = searchParams.get("textSource");

  if (!book || !chapter || !textSource) {
    return NextResponse.json({ error: "Missing required params." }, { status: 400 });
  }

  const rows = userSqlite
    .prepare(
      "SELECT word_id, label FROM constituent_labels WHERE workspace_id = ? AND book = ? AND chapter = ? AND text_source = ?"
    )
    .all(workspaceId, book, chapter, textSource) as { word_id: string; label: string }[];

  return NextResponse.json(rows.map((r) => ({ wordId: r.word_id, label: r.label })));
}

// ── PUT /api/interlinear/constituent-labels ────────────────────────────────────
// Upserts a constituent label for a single word.
// Body: { workspaceId, wordId, label, textSource, book, chapter }
export async function PUT(request: NextRequest) {
  let body: { workspaceId?: number; wordId?: string; label?: string; textSource?: string; book?: string; chapter?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { workspaceId = 1, wordId, label, textSource, book, chapter } = body;
  if (!wordId || !label || !textSource || !book || chapter == null) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  userSqlite
    .prepare(
      `INSERT INTO constituent_labels (workspace_id, word_id, label, text_source, book, chapter)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, word_id) DO UPDATE SET label = excluded.label`
    )
    .run(workspaceId, wordId, label, textSource, book, chapter);

  return NextResponse.json({ ok: true });
}

// ── DELETE /api/interlinear/constituent-labels ─────────────────────────────────
// Removes the constituent label for a single word.
// Body: { workspaceId, wordId }
export async function DELETE(request: NextRequest) {
  let body: { workspaceId?: number; wordId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { workspaceId = 1, wordId } = body;
  if (!wordId) {
    return NextResponse.json({ error: "Missing wordId." }, { status: 400 });
  }

  userSqlite
    .prepare("DELETE FROM constituent_labels WHERE workspace_id = ? AND word_id = ?")
    .run(workspaceId, wordId);

  return NextResponse.json({ ok: true });
}
