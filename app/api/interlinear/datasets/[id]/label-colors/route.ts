import { NextRequest, NextResponse } from "next/server";
import { userSqlite } from "@/lib/db";

export const dynamic = "force-dynamic";

// ── GET /api/interlinear/datasets/[id]/label-colors ───────────────────────────
// Returns all value → color overrides for a dataset.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const datasetId = parseInt(id);
  if (isNaN(datasetId)) {
    return NextResponse.json({ error: "Invalid dataset id." }, { status: 400 });
  }

  const rows = userSqlite
    .prepare("SELECT value, color FROM word_dataset_label_colors WHERE dataset_id = ?")
    .all(datasetId) as { value: string; color: string }[];

  return NextResponse.json(rows);
}

// ── PUT /api/interlinear/datasets/[id]/label-colors ───────────────────────────
// Upserts a color override for one label value.
// Body: { value, color }
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const datasetId = parseInt(id);
  if (isNaN(datasetId)) {
    return NextResponse.json({ error: "Invalid dataset id." }, { status: 400 });
  }

  let body: { value?: string; color?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { value, color } = body;
  if (!value || !color) {
    return NextResponse.json({ error: "Missing value or color." }, { status: 400 });
  }

  userSqlite
    .prepare(
      `INSERT INTO word_dataset_label_colors (dataset_id, value, color)
       VALUES (?, ?, ?)
       ON CONFLICT(dataset_id, value) DO UPDATE SET color = excluded.color`
    )
    .run(datasetId, value, color);

  return NextResponse.json({ ok: true });
}

// ── DELETE /api/interlinear/datasets/[id]/label-colors ────────────────────────
// Clears a label's color override, reverting it to the auto-assigned color.
// Body: { value }
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const datasetId = parseInt(id);
  if (isNaN(datasetId)) {
    return NextResponse.json({ error: "Invalid dataset id." }, { status: 400 });
  }

  let body: { value?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { value } = body;
  if (!value) {
    return NextResponse.json({ error: "Missing value." }, { status: 400 });
  }

  userSqlite
    .prepare("DELETE FROM word_dataset_label_colors WHERE dataset_id = ? AND value = ?")
    .run(datasetId, value);

  return NextResponse.json({ ok: true });
}
