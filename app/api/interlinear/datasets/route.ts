import { NextRequest, NextResponse } from "next/server";
import { userSqlite } from "@/lib/db";

export const dynamic = "force-dynamic";

// ── GET /api/interlinear/datasets ─────────────────────────────────────────────
// Lists all datasets for a workspace.
// Query params: workspaceId (default 1)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceId = parseInt(searchParams.get("workspaceId") ?? "1");

  const rows = userSqlite
    .prepare("SELECT id, name, direction, created_at FROM word_datasets WHERE workspace_id = ? ORDER BY created_at ASC")
    .all(workspaceId) as { id: number; name: string; direction: string; created_at: string }[];

  return NextResponse.json(rows.map((r) => ({ id: r.id, name: r.name, direction: r.direction, createdAt: r.created_at })));
}

// ── POST /api/interlinear/datasets ────────────────────────────────────────────
// Creates a new dataset.
// Body: { workspaceId, name, direction }
export async function POST(request: NextRequest) {
  let body: { workspaceId?: number; name?: string; direction?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { workspaceId = 1, name, direction = "ltr" } = body;
  if (!name?.trim()) {
    return NextResponse.json({ error: "Dataset name is required." }, { status: 400 });
  }
  if (direction !== "ltr" && direction !== "rtl") {
    return NextResponse.json({ error: "Direction must be \"ltr\" or \"rtl\"." }, { status: 400 });
  }

  const result = userSqlite
    .prepare(
      "INSERT INTO word_datasets (workspace_id, name, direction, created_at) VALUES (?, ?, ?, ?) RETURNING id, name, direction, created_at"
    )
    .get(workspaceId, name.trim(), direction, new Date().toISOString()) as { id: number; name: string; direction: string; created_at: string };

  return NextResponse.json({ id: result.id, name: result.name, direction: result.direction, createdAt: result.created_at });
}
