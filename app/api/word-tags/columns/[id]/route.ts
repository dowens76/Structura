import { NextRequest, NextResponse } from "next/server";
import { userSqlite } from "@/lib/db";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// ── PATCH /api/word-tags/columns/[id] ─────────────────────────────────────────
// Renames a column and/or updates its sort order.
// Body: { name?: string; sortOrder?: number }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await getActiveWorkspaceId();
  const { id } = await params;
  const columnId = parseInt(id);
  if (isNaN(columnId)) {
    return NextResponse.json({ error: "Invalid column id." }, { status: 400 });
  }

  let body: { name?: string; sortOrder?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const owned = userSqlite
    .prepare("SELECT id FROM word_tag_columns WHERE id = ? AND workspace_id = ?")
    .get(columnId, workspaceId);
  if (!owned) {
    return NextResponse.json({ error: "Column not found." }, { status: 404 });
  }

  if (body.name?.trim()) {
    userSqlite.prepare("UPDATE word_tag_columns SET name = ? WHERE id = ?").run(body.name.trim(), columnId);
  }
  if (body.sortOrder != null) {
    userSqlite.prepare("UPDATE word_tag_columns SET sort_order = ? WHERE id = ?").run(body.sortOrder, columnId);
  }

  return NextResponse.json({ ok: true });
}

// ── DELETE /api/word-tags/columns/[id] ────────────────────────────────────────
// Deletes a column and its options/values (cascade).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await getActiveWorkspaceId();
  const { id } = await params;
  const columnId = parseInt(id);
  if (isNaN(columnId)) {
    return NextResponse.json({ error: "Invalid column id." }, { status: 400 });
  }

  userSqlite.prepare("DELETE FROM word_tag_columns WHERE id = ? AND workspace_id = ?").run(columnId, workspaceId);

  return NextResponse.json({ ok: true });
}
