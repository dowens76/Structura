import { NextRequest, NextResponse } from "next/server";
import { userSqlite } from "@/lib/db";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// ── DELETE /api/word-tags/columns/[id]/options/[optionId] ────────────────────
// Deletes a reusable list entry (cascades any cell values referencing it).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; optionId: string }> }
) {
  const workspaceId = await getActiveWorkspaceId();
  const { id, optionId } = await params;
  const columnId = parseInt(id);
  const optId = parseInt(optionId);
  if (isNaN(columnId) || isNaN(optId)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const owned = userSqlite
    .prepare("SELECT id FROM word_tag_columns WHERE id = ? AND workspace_id = ?")
    .get(columnId, workspaceId);
  if (!owned) {
    return NextResponse.json({ error: "Column not found." }, { status: 404 });
  }

  userSqlite.prepare("DELETE FROM word_tag_column_options WHERE id = ? AND column_id = ?").run(optId, columnId);

  return NextResponse.json({ ok: true });
}
