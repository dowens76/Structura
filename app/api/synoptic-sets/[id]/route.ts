import { NextRequest, NextResponse } from "next/server";
import {
  getSynopticSet,
  updateSynopticSetMeta,
  replaceSynopticSetColumns,
  deleteSynopticSet,
  type SynopticSetColumnInput,
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/synoptic-sets/[id]
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const workspaceId = await getActiveWorkspaceId();
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const set = await getSynopticSet(id, workspaceId);
  if (!set) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ set });
}

/**
 * PUT /api/synoptic-sets/[id]
 * Body: { title?, corpus?, columns?: [...] } — when `columns` is present, every
 * existing column is replaced (add/remove/reorder/rebook all handled by full
 * replacement — see replaceSynopticSetColumns).
 */
export async function PUT(request: NextRequest, { params }: RouteContext) {
  const workspaceId = await getActiveWorkspaceId();
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const existing = await getSynopticSet(id, workspaceId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

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

  const metaUpdates: { title?: string; corpus?: string } = {};
  if (body.title  !== undefined) metaUpdates.title  = body.title;
  if (body.corpus !== undefined) metaUpdates.corpus = body.corpus;
  if (Object.keys(metaUpdates).length > 0) {
    await updateSynopticSetMeta(id, metaUpdates, workspaceId);
  }

  if (body.columns) {
    if (body.columns.length === 0) {
      return NextResponse.json({ error: "A synoptic set needs at least one column" }, { status: 400 });
    }
    await replaceSynopticSetColumns(id, body.columns, workspaceId);
  }

  const set = await getSynopticSet(id, workspaceId);
  return NextResponse.json({ set });
}

// DELETE /api/synoptic-sets/[id]
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const workspaceId = await getActiveWorkspaceId();
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  await deleteSynopticSet(id, workspaceId);
  return NextResponse.json({ ok: true });
}
