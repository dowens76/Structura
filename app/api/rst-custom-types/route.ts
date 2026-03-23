import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rstCustomTypes } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

// GET /api/rst-custom-types → all custom types ordered by sortOrder
export async function GET() {
  const rows = await db
    .select()
    .from(rstCustomTypes)
    .orderBy(asc(rstCustomTypes.sortOrder), asc(rstCustomTypes.id));
  return NextResponse.json(rows);
}

// POST /api/rst-custom-types
// Body: { label, abbr, color, category }
export async function POST(request: NextRequest) {
  const { label, abbr, color, category } = await request.json();
  if (!label || !abbr || !color || !category) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Generate a unique key: "custom_" + 8 random alphanumeric chars
  const randomPart = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  const key = `custom_${randomPart}`;

  // sortOrder = count of existing custom rows
  const existing = await db.select().from(rstCustomTypes);
  const sortOrder = existing.length;

  const [row] = await db
    .insert(rstCustomTypes)
    .values({ key, label, abbr: abbr.slice(0, 4), color, category, sortOrder })
    .returning();

  return NextResponse.json(row, { status: 201 });
}

// PATCH /api/rst-custom-types
// Body: { id, label?, abbr?, color?, category? }
export async function PATCH(request: NextRequest) {
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

  const [row] = await db
    .update(rstCustomTypes)
    .set(updates)
    .where(eq(rstCustomTypes.id, id))
    .returning();

  return NextResponse.json(row);
}

// DELETE /api/rst-custom-types?id=<id>
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get("id") ?? "", 10);
  if (isNaN(id)) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await db.delete(rstCustomTypes).where(eq(rstCustomTypes.id, id));
  return new NextResponse(null, { status: 204 });
}
