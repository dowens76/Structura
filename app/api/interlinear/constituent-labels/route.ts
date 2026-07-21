import { NextRequest, NextResponse } from "next/server";
import { userSqlite } from "@/lib/db";

export const dynamic = "force-dynamic";

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
      "SELECT word_id, label, group_id FROM constituent_labels WHERE workspace_id = ? AND book = ? AND chapter = ? AND text_source = ?"
    )
    .all(workspaceId, book, chapter, textSource) as { word_id: string; label: string; group_id: string | null }[];

  return NextResponse.json(rows.map((r) => ({ wordId: r.word_id, label: r.label, groupId: r.group_id })));
}

// ── PUT /api/interlinear/constituent-labels ────────────────────────────────────
// Upserts one or more words sharing a single label.
// Body: { workspaceId, wordId, label, textSource, book, chapter } — single word (legacy shape)
//    or { workspaceId, wordIds, label, textSource, book, chapter, groupId } — a grouping.
// When groupId is provided, any existing rows in that group not present in
// wordIds are removed first (so shrinking a grouping during an edit works).
export async function PUT(request: NextRequest) {
  let body: {
    workspaceId?: number;
    wordId?: string;
    wordIds?: string[];
    label?: string;
    textSource?: string;
    book?: string;
    chapter?: number;
    groupId?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { workspaceId = 1, label, textSource, book, chapter, groupId } = body;
  const wordIds = body.wordIds ?? (body.wordId ? [body.wordId] : []);
  if (wordIds.length === 0 || !label || !textSource || !book || chapter == null) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  const tx = userSqlite.transaction(() => {
    if (groupId) {
      const placeholders = wordIds.map(() => "?").join(",");
      userSqlite
        .prepare(
          `DELETE FROM constituent_labels WHERE workspace_id = ? AND group_id = ? AND word_id NOT IN (${placeholders})`
        )
        .run(workspaceId, groupId, ...wordIds);
    }
    const stmt = userSqlite.prepare(
      `INSERT INTO constituent_labels (workspace_id, word_id, label, group_id, text_source, book, chapter)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, word_id) DO UPDATE SET
         label = excluded.label,
         group_id = COALESCE(excluded.group_id, constituent_labels.group_id)`
    );
    for (const wordId of wordIds) {
      stmt.run(workspaceId, wordId, label, groupId ?? null, textSource, book, chapter);
    }
  });
  tx();

  return NextResponse.json({ ok: true, groupId: groupId ?? null });
}

// ── DELETE /api/interlinear/constituent-labels ─────────────────────────────────
// Removes a single word's label, or an entire grouping.
// Body: { workspaceId, wordId } or { workspaceId, groupId }
export async function DELETE(request: NextRequest) {
  let body: { workspaceId?: number; wordId?: string; groupId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { workspaceId = 1, wordId, groupId } = body;
  if (groupId) {
    userSqlite
      .prepare("DELETE FROM constituent_labels WHERE workspace_id = ? AND group_id = ?")
      .run(workspaceId, groupId);
  } else if (wordId) {
    userSqlite
      .prepare("DELETE FROM constituent_labels WHERE workspace_id = ? AND word_id = ?")
      .run(workspaceId, wordId);
  } else {
    return NextResponse.json({ error: "Missing wordId or groupId." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
