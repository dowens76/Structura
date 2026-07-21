import { NextRequest, NextResponse } from "next/server";
import { userDb } from "@/lib/db";
import { commFunctionCustomTypes } from "@/lib/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// GET /api/comm-function-custom-types → all custom communicative functions ordered by sortOrder
export async function GET() {
  const workspaceId = await getActiveWorkspaceId();
  const rows = await userDb
    .select()
    .from(commFunctionCustomTypes)
    .where(eq(commFunctionCustomTypes.workspaceId, workspaceId))
    .orderBy(asc(commFunctionCustomTypes.sortOrder), asc(commFunctionCustomTypes.id));
  return NextResponse.json(rows);
}

// POST /api/comm-function-custom-types
// Body: { category, label }
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { category, label } = await request.json();
  if (!category || !label) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Generate a unique key: "custom_" + 8 random alphanumeric chars
  const randomPart = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  const key = `custom_${randomPart}`;

  // sortOrder = count of existing custom rows
  const existing = await userDb.select().from(commFunctionCustomTypes).where(eq(commFunctionCustomTypes.workspaceId, workspaceId));
  const sortOrder = existing.length;

  const [row] = await userDb
    .insert(commFunctionCustomTypes)
    .values({ key, category, label, sortOrder, workspaceId })
    .returning();

  return NextResponse.json(row, { status: 201 });
}

// PATCH /api/comm-function-custom-types
// Body: { id, label?, category? }
export async function PATCH(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { id, label, category } = await request.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const updates: Partial<{ label: string; category: string }> = {};
  if (label    !== undefined) updates.label    = label;
  if (category !== undefined) updates.category = category;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const [row] = await userDb
    .update(commFunctionCustomTypes)
    .set(updates)
    .where(and(eq(commFunctionCustomTypes.id, id), eq(commFunctionCustomTypes.workspaceId, workspaceId)))
    .returning();

  return NextResponse.json(row);
}

// DELETE /api/comm-function-custom-types?id=<id>
export async function DELETE(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get("id") ?? "", 10);
  if (isNaN(id)) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await userDb.delete(commFunctionCustomTypes).where(and(eq(commFunctionCustomTypes.id, id), eq(commFunctionCustomTypes.workspaceId, workspaceId)));
  return new NextResponse(null, { status: 204 });
}
