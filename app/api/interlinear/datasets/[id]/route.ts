import { NextRequest, NextResponse } from "next/server";
import { userSqlite } from "@/lib/db";

export const dynamic = "force-dynamic";

// ── DELETE /api/interlinear/datasets/[id] ─────────────────────────────────────
// Deletes a dataset and all its entries (cascade).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const datasetId = parseInt(id);
  if (isNaN(datasetId)) {
    return NextResponse.json({ error: "Invalid dataset id." }, { status: 400 });
  }

  userSqlite
    .prepare("DELETE FROM word_datasets WHERE id = ?")
    .run(datasetId);

  return NextResponse.json({ ok: true });
}

// ── PATCH /api/interlinear/datasets/[id] ──────────────────────────────────────
// Renames a dataset and/or changes its text direction.
// Body: { name?, direction? } — at least one required.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const datasetId = parseInt(id);
  if (isNaN(datasetId)) {
    return NextResponse.json({ error: "Invalid dataset id." }, { status: 400 });
  }

  let body: { name?: string; direction?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { name, direction } = body;
  if (name === undefined && direction === undefined) {
    return NextResponse.json({ error: "Name or direction is required." }, { status: 400 });
  }
  if (name !== undefined && !name.trim()) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  if (direction !== undefined && direction !== "ltr" && direction !== "rtl") {
    return NextResponse.json({ error: "Direction must be \"ltr\" or \"rtl\"." }, { status: 400 });
  }

  if (name !== undefined) {
    userSqlite.prepare("UPDATE word_datasets SET name = ? WHERE id = ?").run(name.trim(), datasetId);
  }
  if (direction !== undefined) {
    userSqlite.prepare("UPDATE word_datasets SET direction = ? WHERE id = ?").run(direction, datasetId);
  }

  return NextResponse.json({ ok: true });
}
