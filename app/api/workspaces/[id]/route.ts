import { NextRequest, NextResponse } from "next/server";
import { userDb } from "@/lib/db";
import { workspaces } from "@/lib/db/user-schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// PATCH /api/workspaces/[id] — update workspace (name and/or translationOnly)
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: { name?: string; translationOnly?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Partial<{ name: string; translationOnly: boolean }> = {};
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.translationOnly !== undefined) patch.translationOnly = body.translationOnly;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  if (patch.name !== undefined && !patch.name) {
    return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
  }

  const [workspace] = await userDb
    .update(workspaces)
    .set(patch)
    .where(eq(workspaces.id, id))
    .returning();

  if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  return NextResponse.json({ workspace });
}

// DELETE /api/workspaces/[id] — delete a workspace (guard: min 1 per user)
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  // Find the workspace to get its userId
  const [ws] = await userDb
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1);

  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  // Count how many workspaces this user has
  const allForUser = await userDb
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.userId, ws.userId));

  if (allForUser.length <= 1) {
    return NextResponse.json(
      { error: "Cannot delete the last workspace — create another one first." },
      { status: 409 }
    );
  }

  await userDb.delete(workspaces).where(eq(workspaces.id, id));
  return NextResponse.json({ ok: true });
}
