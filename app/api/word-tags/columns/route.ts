import { NextRequest, NextResponse } from "next/server";
import { userSqlite } from "@/lib/db";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { loadWordTagColumns } from "@/lib/db/word-tag-columns";

export const dynamic = "force-dynamic";

// ── GET /api/word-tags/columns?tagName=X ──────────────────────────────────────
// Lists the custom classification columns for a concept/word-tag group,
// seeding a default "Tags" (list-type) column the first time it's requested.
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const tagName = new URL(request.url).searchParams.get("tagName");
  if (!tagName) {
    return NextResponse.json({ error: "Missing tagName." }, { status: 400 });
  }

  return NextResponse.json({ columns: loadWordTagColumns(workspaceId, tagName) });
}

// ── POST /api/word-tags/columns ───────────────────────────────────────────────
// Creates a new custom column. Body: { tagName, name, type: "text"|"list" }
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();

  let body: { tagName?: string; name?: string; type?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { tagName, name, type } = body;
  if (!tagName || !name?.trim() || (type !== "text" && type !== "list")) {
    return NextResponse.json({ error: "Missing or invalid tagName, name, or type." }, { status: 400 });
  }

  const maxRow = userSqlite
    .prepare("SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM word_tag_columns WHERE workspace_id = ? AND tag_name = ?")
    .get(workspaceId, tagName) as { maxOrder: number };

  try {
    const info = userSqlite
      .prepare(
        "INSERT INTO word_tag_columns (workspace_id, tag_name, name, type, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(workspaceId, tagName, name.trim(), type, maxRow.maxOrder + 1, new Date().toISOString());
    return NextResponse.json({ id: info.lastInsertRowid, tagName, name: name.trim(), type, sortOrder: maxRow.maxOrder + 1, options: type === "list" ? [] : undefined });
  } catch {
    return NextResponse.json({ error: "A column with that name already exists." }, { status: 409 });
  }
}
