import { NextRequest, NextResponse } from "next/server";
import { renameVersion, deleteVersion } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

// PATCH /api/versions/[id] — rename a version (cascades to groupKey siblings)
// Body: { name }
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const version = await renameVersion(id, body.name);
  return NextResponse.json({ version });
}

// DELETE /api/versions/[id] — delete a version (cascades to its markup and to groupKey siblings)
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  await deleteVersion(id);
  return NextResponse.json({ ok: true });
}
