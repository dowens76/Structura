import { NextRequest, NextResponse } from "next/server";
import { userSqlite } from "@/lib/db";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// ── POST /api/word-tags/columns/[id]/options ──────────────────────────────────
// Creates a new reusable list entry for a "list"-type column. Idempotent: if
// the value already exists on this column, returns the existing option.
// Body: { value: string; color?: string }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await getActiveWorkspaceId();
  const { id } = await params;
  const columnId = parseInt(id);
  if (isNaN(columnId)) {
    return NextResponse.json({ error: "Invalid column id." }, { status: 400 });
  }

  let body: { value?: string; color?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const value = body.value?.trim();
  if (!value) {
    return NextResponse.json({ error: "Missing value." }, { status: 400 });
  }

  const column = userSqlite
    .prepare("SELECT id, type FROM word_tag_columns WHERE id = ? AND workspace_id = ?")
    .get(columnId, workspaceId) as { id: number; type: string } | undefined;
  if (!column) {
    return NextResponse.json({ error: "Column not found." }, { status: 404 });
  }
  if (column.type !== "list") {
    return NextResponse.json({ error: "Column is not a list-type column." }, { status: 400 });
  }

  const existing = userSqlite
    .prepare("SELECT id, value, color, sort_order FROM word_tag_column_options WHERE column_id = ? AND value = ?")
    .get(columnId, value) as { id: number; value: string; color: string | null; sort_order: number } | undefined;
  if (existing) {
    return NextResponse.json({ id: existing.id, value: existing.value, color: existing.color, sortOrder: existing.sort_order });
  }

  const maxRow = userSqlite
    .prepare("SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM word_tag_column_options WHERE column_id = ?")
    .get(columnId) as { maxOrder: number };

  const info = userSqlite
    .prepare("INSERT INTO word_tag_column_options (column_id, value, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(columnId, value, body.color ?? null, maxRow.maxOrder + 1, new Date().toISOString());

  return NextResponse.json({ id: info.lastInsertRowid, value, color: body.color ?? null, sortOrder: maxRow.maxOrder + 1 });
}
