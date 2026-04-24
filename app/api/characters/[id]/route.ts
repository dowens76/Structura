import { NextRequest, NextResponse } from "next/server";
import { deleteCharacter, updateCharacter } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

// PATCH /api/characters/:id  — update name and/or color
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  let body: { name?: string; color?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { name, color } = body;
  if (!name || !color) {
    return NextResponse.json({ error: "Missing name or color" }, { status: 400 });
  }
  const character = await updateCharacter(numId, name, color);
  return NextResponse.json({ character });
}

// DELETE /api/characters/:id
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  await deleteCharacter(numId);
  return NextResponse.json({ ok: true });
}
