import { NextRequest, NextResponse } from "next/server";
import { updateWordTag, deleteWordTag } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

// PATCH /api/word-tags/:id  body: { name, color }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  let body: { name?: string; color?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { name, color } = body;
  if (!name || !color) return NextResponse.json({ error: "Missing name or color" }, { status: 400 });
  const tag = await updateWordTag(numId, name, color);
  return NextResponse.json({ tag });
}

// DELETE /api/word-tags/:id
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  await deleteWordTag(numId);
  return NextResponse.json({ ok: true });
}
