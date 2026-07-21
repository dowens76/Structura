import { NextRequest, NextResponse } from "next/server";
import { userSqlite } from "@/lib/db";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// ── PUT /api/word-tags/columns/[id]/values ────────────────────────────────────
// Sets a cell value for one occurrence.
// List-type columns:  { wordId, optionId }        — adds/keeps that chip on the occurrence.
// Text-type columns:  { wordId, textValue }        — replaces the occurrence's single text value.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await getActiveWorkspaceId();
  const { id } = await params;
  const columnId = parseInt(id);
  if (isNaN(columnId)) {
    return NextResponse.json({ error: "Invalid column id." }, { status: 400 });
  }

  let body: { wordId?: string; optionId?: number; textValue?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { wordId, optionId, textValue } = body;
  if (!wordId) {
    return NextResponse.json({ error: "Missing wordId." }, { status: 400 });
  }

  const column = userSqlite
    .prepare("SELECT id FROM word_tag_columns WHERE id = ? AND workspace_id = ?")
    .get(columnId, workspaceId);
  if (!column) {
    return NextResponse.json({ error: "Column not found." }, { status: 404 });
  }

  if (optionId != null) {
    userSqlite
      .prepare("INSERT OR IGNORE INTO word_tag_column_values (column_id, word_id, option_id, created_at) VALUES (?, ?, ?, ?)")
      .run(columnId, wordId, optionId, new Date().toISOString());
  } else if (textValue != null) {
    const tx = userSqlite.transaction(() => {
      userSqlite
        .prepare("DELETE FROM word_tag_column_values WHERE column_id = ? AND word_id = ? AND option_id IS NULL")
        .run(columnId, wordId);
      if (textValue.trim().length > 0) {
        userSqlite
          .prepare("INSERT INTO word_tag_column_values (column_id, word_id, option_id, text_value, created_at) VALUES (?, ?, NULL, ?, ?)")
          .run(columnId, wordId, textValue, new Date().toISOString());
      }
    });
    tx();
  } else {
    return NextResponse.json({ error: "Missing optionId or textValue." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

// ── DELETE /api/word-tags/columns/[id]/values ─────────────────────────────────
// Removes a single list chip from an occurrence. Body: { wordId, optionId }
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await getActiveWorkspaceId();
  const { id } = await params;
  const columnId = parseInt(id);
  if (isNaN(columnId)) {
    return NextResponse.json({ error: "Invalid column id." }, { status: 400 });
  }

  let body: { wordId?: string; optionId?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { wordId, optionId } = body;
  if (!wordId || optionId == null) {
    return NextResponse.json({ error: "Missing wordId or optionId." }, { status: 400 });
  }

  const column = userSqlite
    .prepare("SELECT id FROM word_tag_columns WHERE id = ? AND workspace_id = ?")
    .get(columnId, workspaceId);
  if (!column) {
    return NextResponse.json({ error: "Column not found." }, { status: 404 });
  }

  userSqlite
    .prepare("DELETE FROM word_tag_column_values WHERE column_id = ? AND word_id = ? AND option_id = ?")
    .run(columnId, wordId, optionId);

  return NextResponse.json({ ok: true });
}
