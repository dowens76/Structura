import { NextRequest, NextResponse } from "next/server";
import { userSqlite } from "@/lib/db";

export const dynamic = "force-dynamic";

// ── GET /api/interlinear/datasets/[id]/entries ────────────────────────────────
// Returns entries for a dataset for a given chapter.
// Query params: book, chapter, textSource
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const datasetId = parseInt(id);
  if (isNaN(datasetId)) {
    return NextResponse.json({ error: "Invalid dataset id." }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const book       = searchParams.get("book");
  const chapter    = parseInt(searchParams.get("chapter") ?? "0");
  const textSource = searchParams.get("textSource");

  if (!book || !chapter || !textSource) {
    return NextResponse.json({ error: "Missing required params." }, { status: 400 });
  }

  const rows = userSqlite
    .prepare(
      "SELECT word_id, value FROM word_dataset_entries WHERE dataset_id = ? AND book = ? AND chapter = ? AND text_source = ?"
    )
    .all(datasetId, book, chapter, textSource) as { word_id: string; value: string }[];

  return NextResponse.json(rows.map((r) => ({ wordId: r.word_id, value: r.value })));
}

// ── PUT /api/interlinear/datasets/[id]/entries ────────────────────────────────
// Upserts a single entry (word → value).
// Body: { wordId, value, textSource, book, chapter }
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const datasetId = parseInt(id);
  if (isNaN(datasetId)) {
    return NextResponse.json({ error: "Invalid dataset id." }, { status: 400 });
  }

  let body: { wordId?: string; value?: string; textSource?: string; book?: string; chapter?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { wordId, value, textSource, book, chapter } = body;
  if (!wordId || value == null || !textSource || !book || chapter == null) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  userSqlite
    .prepare(
      `INSERT INTO word_dataset_entries (dataset_id, word_id, value, text_source, book, chapter)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(dataset_id, word_id) DO UPDATE SET value = excluded.value`
    )
    .run(datasetId, wordId, value, textSource, book, chapter);

  return NextResponse.json({ ok: true });
}

// ── DELETE /api/interlinear/datasets/[id]/entries ─────────────────────────────
// Removes a single entry.
// Body: { wordId }
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const datasetId = parseInt(id);
  if (isNaN(datasetId)) {
    return NextResponse.json({ error: "Invalid dataset id." }, { status: 400 });
  }

  let body: { wordId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { wordId } = body;
  if (!wordId) {
    return NextResponse.json({ error: "Missing wordId." }, { status: 400 });
  }

  userSqlite
    .prepare("DELETE FROM word_dataset_entries WHERE dataset_id = ? AND word_id = ?")
    .run(datasetId, wordId);

  return NextResponse.json({ ok: true });
}
