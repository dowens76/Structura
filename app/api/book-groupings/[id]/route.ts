import { NextRequest, NextResponse } from "next/server";
import { updateBookGrouping, deleteBookGrouping } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// PUT /api/book-groupings/[id]
// Body: { name, books, features }
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await getActiveWorkspaceId();
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: { name?: string; books?: string[]; features?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, books = [], features = [] } = body;
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const grouping = await updateBookGrouping(id, workspaceId, name.trim(), books, features);
  if (!grouping) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ grouping });
}

// DELETE /api/book-groupings/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await getActiveWorkspaceId();
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  await deleteBookGrouping(id, workspaceId);
  return NextResponse.json({ ok: true });
}
