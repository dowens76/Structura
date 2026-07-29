import { NextRequest, NextResponse } from "next/server";
import { userDb } from "@/lib/db";
import { synopticCategoryTypes } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// POST /api/synoptic-category-types/reorder  body: { items: [{ id, sortOrder }] }
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { items?: { id: number; sortOrder: number }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { items } = body;
  if (!Array.isArray(items)) {
    return NextResponse.json({ error: "items must be an array" }, { status: 400 });
  }
  for (const { id, sortOrder } of items) {
    await userDb
      .update(synopticCategoryTypes)
      .set({ sortOrder })
      .where(and(eq(synopticCategoryTypes.id, id), eq(synopticCategoryTypes.workspaceId, workspaceId)));
  }
  return NextResponse.json({ ok: true });
}
