import { NextRequest, NextResponse } from "next/server";
import { userSqlite } from "@/lib/db";

export const dynamic = "force-dynamic";

// Deletes each value's color override once no entry in the dataset uses that
// value anymore, so removing a group/word doesn't leave an unreachable
// word_dataset_label_colors row behind.
function pruneOrphanedLabelColors(datasetId: number, values: string[]) {
  const stillUsed = userSqlite.prepare(
    "SELECT 1 FROM word_dataset_entries WHERE dataset_id = ? AND value = ? LIMIT 1"
  );
  const prune = userSqlite.prepare(
    "DELETE FROM word_dataset_label_colors WHERE dataset_id = ? AND value = ?"
  );
  for (const value of new Set(values)) {
    if (!stillUsed.get(datasetId, value)) prune.run(datasetId, value);
  }
}

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
      "SELECT word_id, value, group_id FROM word_dataset_entries WHERE dataset_id = ? AND book = ? AND chapter = ? AND text_source = ?"
    )
    .all(datasetId, book, chapter, textSource) as { word_id: string; value: string; group_id: string | null }[];

  return NextResponse.json(rows.map((r) => ({ wordId: r.word_id, value: r.value, groupId: r.group_id })));
}

// ── PUT /api/interlinear/datasets/[id]/entries ────────────────────────────────
// Upserts one or more entries sharing a single value.
// Body: { wordId, value, textSource, book, chapter } — single word (legacy shape)
//    or { wordIds, value, textSource, book, chapter, groupId } — a grouping.
// When groupId is provided, any existing rows in that group not present in
// wordIds are removed first (so shrinking a grouping during an edit works).
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const datasetId = parseInt(id);
  if (isNaN(datasetId)) {
    return NextResponse.json({ error: "Invalid dataset id." }, { status: 400 });
  }

  let body: {
    wordId?: string;
    wordIds?: string[];
    value?: string;
    textSource?: string;
    book?: string;
    chapter?: number;
    groupId?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const wordIds = body.wordIds ?? (body.wordId ? [body.wordId] : []);
  const { value, textSource, book, chapter, groupId } = body;
  if (wordIds.length === 0 || value == null || !textSource || !book || chapter == null) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  const tx = userSqlite.transaction(() => {
    if (groupId) {
      const placeholders = wordIds.map(() => "?").join(",");
      userSqlite
        .prepare(
          `DELETE FROM word_dataset_entries WHERE dataset_id = ? AND group_id = ? AND word_id NOT IN (${placeholders})`
        )
        .run(datasetId, groupId, ...wordIds);
    }
    const stmt = userSqlite.prepare(
      `INSERT INTO word_dataset_entries (dataset_id, word_id, value, text_source, book, chapter, group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(dataset_id, word_id) DO UPDATE SET
         value = excluded.value,
         group_id = COALESCE(excluded.group_id, word_dataset_entries.group_id)`
    );
    for (const wordId of wordIds) {
      stmt.run(datasetId, wordId, value, textSource, book, chapter, groupId ?? null);
    }
  });
  tx();

  return NextResponse.json({ ok: true, groupId: groupId ?? null });
}

// ── DELETE /api/interlinear/datasets/[id]/entries ─────────────────────────────
// Removes a single entry, or an entire grouping.
// Body: { wordId } or { groupId }
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const datasetId = parseInt(id);
  if (isNaN(datasetId)) {
    return NextResponse.json({ error: "Invalid dataset id." }, { status: 400 });
  }

  let body: { wordId?: string; groupId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { wordId, groupId } = body;
  if (groupId) {
    const tx = userSqlite.transaction(() => {
      const values = userSqlite
        .prepare("SELECT DISTINCT value FROM word_dataset_entries WHERE dataset_id = ? AND group_id = ?")
        .all(datasetId, groupId) as { value: string }[];

      userSqlite
        .prepare("DELETE FROM word_dataset_entries WHERE dataset_id = ? AND group_id = ?")
        .run(datasetId, groupId);

      pruneOrphanedLabelColors(datasetId, values.map((v) => v.value));
    });
    tx();
  } else if (wordId) {
    const tx = userSqlite.transaction(() => {
      const row = userSqlite
        .prepare("SELECT value FROM word_dataset_entries WHERE dataset_id = ? AND word_id = ?")
        .get(datasetId, wordId) as { value: string } | undefined;

      userSqlite
        .prepare("DELETE FROM word_dataset_entries WHERE dataset_id = ? AND word_id = ?")
        .run(datasetId, wordId);

      if (row) pruneOrphanedLabelColors(datasetId, [row.value]);
    });
    tx();
  } else {
    return NextResponse.json({ error: "Missing wordId or groupId." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
