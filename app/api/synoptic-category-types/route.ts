import { NextRequest, NextResponse } from "next/server";
import { userDb } from "@/lib/db";
import { synopticCategoryTypes } from "@/lib/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// GET /api/synoptic-category-types → all synoptic-comparison categories ordered by sortOrder
export async function GET() {
  const workspaceId = await getActiveWorkspaceId();
  const rows = await userDb
    .select()
    .from(synopticCategoryTypes)
    .where(eq(synopticCategoryTypes.workspaceId, workspaceId))
    .orderBy(asc(synopticCategoryTypes.sortOrder), asc(synopticCategoryTypes.id));
  return NextResponse.json(rows);
}

// POST /api/synoptic-category-types
// Body: { label, color }
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { label, color } = await request.json();
  if (!label || !color) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Generate a unique key: "custom_" + 8 random alphanumeric chars
  const randomPart = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  const key = `custom_${randomPart}`;

  const existing = await userDb.select().from(synopticCategoryTypes).where(eq(synopticCategoryTypes.workspaceId, workspaceId));
  const sortOrder = existing.length;

  const [row] = await userDb
    .insert(synopticCategoryTypes)
    .values({ key, label, color, sortOrder, workspaceId })
    .returning();

  return NextResponse.json(row, { status: 201 });
}

// PATCH /api/synoptic-category-types
// Body: { id, label?, color? }
export async function PATCH(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { id, label, color } = await request.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const updates: Partial<{ label: string; color: string }> = {};
  if (label !== undefined) updates.label = label;
  if (color !== undefined) updates.color = color;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const [row] = await userDb
    .update(synopticCategoryTypes)
    .set(updates)
    .where(and(eq(synopticCategoryTypes.id, id), eq(synopticCategoryTypes.workspaceId, workspaceId)))
    .returning();

  return NextResponse.json(row);
}

// DELETE /api/synoptic-category-types?id=<id>
export async function DELETE(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get("id") ?? "", 10);
  if (isNaN(id)) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await userDb.delete(synopticCategoryTypes).where(and(eq(synopticCategoryTypes.id, id), eq(synopticCategoryTypes.workspaceId, workspaceId)));
  return new NextResponse(null, { status: 204 });
}
