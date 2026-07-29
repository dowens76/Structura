import { NextRequest, NextResponse } from "next/server";
import { getSynopticSets, createSynopticSet, type SynopticSetColumnInput } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// GET /api/synoptic-sets → all synoptic sets (with their columns), optionally filtered by corpus
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const corpus = searchParams.get("corpus");

  const sets = await getSynopticSets(workspaceId);
  const filtered = corpus ? sets.filter((s) => s.corpus === corpus) : sets;
  return NextResponse.json({ sets: filtered });
}

/**
 * POST /api/synoptic-sets
 * Body: { title, corpus?, columns: [{ book, textSource, columnLabel, startChapter, startVerse, endBook?, endChapter, endVerse }] }
 */
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: {
    title?: string;
    corpus?: string;
    columns?: SynopticSetColumnInput[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { title, corpus, columns } = body;
  if (!title || !columns || columns.length === 0) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  for (const col of columns) {
    if (
      !col.book || !col.textSource || !col.columnLabel ||
      col.startChapter == null || col.startVerse == null ||
      col.endChapter == null || col.endVerse == null
    ) {
      return NextResponse.json({ error: "Missing column fields" }, { status: 400 });
    }
  }

  const set = await createSynopticSet(title, corpus ?? "custom", "custom", null, columns, workspaceId);
  return NextResponse.json({ set }, { status: 201 });
}
