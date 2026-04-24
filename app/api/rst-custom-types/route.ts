import { NextRequest, NextResponse } from "next/server";
import { userDb } from "@/lib/db";
import { rstCustomTypes } from "@/lib/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// GET /api/rst-custom-types → all custom types ordered by sortOrder
export async function GET() {
  const workspaceId = await getActiveWorkspaceId();
  const rows = await userDb
    .select()
    .from(rstCustomTypes)
    .where(eq(rstCustomTypes.workspaceId, workspaceId))
    .orderBy(asc(rstCustomTypes.sortOrder), asc(rstCustomTypes.id));
  return NextResponse.json(rows);
}

// POST /api/rst-custom-types
// Body: { label, abbr, color, category }
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { label, abbr, color, category } = await request.json();
  if (!label || !abbr || !color || !category) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Generate a unique key: "custom_" + 8 random alphanumeric chars
  const randomPart = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  const key = `custom_${randomPart}`;

  // sortOrder = count of existing custom rows
  const existing = await userDb.select().from(rstCustomTypes).where(eq(rstCustomTypes.workspaceId, workspaceId));
  const sortOrder = existing.length;

  const [row] = await userDb
    .insert(rstCustomTypes)
    .values({ key, label, abbr: abbr.slice(0, 4), color, category, sortOrder, workspaceId })
    .returning();

  return NextResponse.json(row, { status: 201 });
}

// PATCH /api/rst-custom-types
// Body: { id, label?, abbr?, color?, category? }
export async function PATCH(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { id, label, abbr, color, category } = await request.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const updates: Partial<{ label: string; abbr: string; color: string; category: "coordinate" | "subordinate" }> = {};
  if (label    !== undefined) updates.label    = label;
  if (abbr     !== undefined) updates.abbr     = abbr.slice(0, 4);
  if (color    !== undefined) updates.color    = color;
  if (category !== undefined) updates.category = category as "coordinate" | "subordinate";

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const [row] = await userDb
    .update(rstCustomTypes)
    .set(updates)
    .where(and(eq(rstCustomTypes.id, id), eq(rstCustomTypes.workspaceId, workspaceId)))
    .returning();

  return NextResponse.json(row);
}

// DELETE /api/rst-custom-types?id=<id>
export async function DELETE(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get("id") ?? "", 10);
  if (isNaN(id)) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await userDb.delete(rstCustomTypes).where(and(eq(rstCustomTypes.id, id), eq(rstCustomTypes.workspaceId, workspaceId)));
  return new NextResponse(null, { status: 204 });
}
