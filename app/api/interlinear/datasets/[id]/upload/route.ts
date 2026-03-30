import { NextRequest, NextResponse } from "next/server";
import { userSqlite } from "@/lib/db";

// ── POST /api/interlinear/datasets/[id]/upload ────────────────────────────────
// Bulk-upserts entries from a parsed file.
// Body: { entries: Array<{ wordId, value, textSource, book, chapter }> }
// Any existing entry for a wordId in this dataset is overwritten.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const datasetId = parseInt(id);
  if (isNaN(datasetId)) {
    return NextResponse.json({ error: "Invalid dataset id." }, { status: 400 });
  }

  let body: { entries?: { wordId: string; value: string; textSource: string; book: string; chapter: number }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const entries = body.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json({ error: "No entries provided." }, { status: 400 });
  }

  const upsert = userSqlite.prepare(
    `INSERT INTO word_dataset_entries (dataset_id, word_id, value, text_source, book, chapter)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(dataset_id, word_id) DO UPDATE SET value = excluded.value`
  );

  const bulk = userSqlite.transaction((rows: typeof entries) => {
    let inserted = 0;
    for (const row of rows) {
      if (!row.wordId || row.value == null || !row.textSource || !row.book || row.chapter == null) continue;
      upsert.run(datasetId, row.wordId, row.value, row.textSource, row.book, row.chapter);
      inserted++;
    }
    return inserted;
  });

  const count = bulk(entries);
  return NextResponse.json({ ok: true, inserted: count });
}
