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
// Renames a dataset.
// Body: { name }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const datasetId = parseInt(id);
  if (isNaN(datasetId)) {
    return NextResponse.json({ error: "Invalid dataset id." }, { status: 400 });
  }

  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { name } = body;
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  userSqlite
    .prepare("UPDATE word_datasets SET name = ? WHERE id = ?")
    .run(name.trim(), datasetId);

  return NextResponse.json({ ok: true });
}
