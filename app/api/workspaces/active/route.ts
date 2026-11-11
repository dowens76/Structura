import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { userDb } from "@/lib/db";
import { workspaces } from "@/lib/db/user-schema";
import { setAppSetting } from "@/lib/db/queries";
import { ACTIVE_WORKSPACE_SETTING_KEY } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// PUT /api/workspaces/active — remember the last-used workspace so the app
// reopens in it after a restart. Body: { id }
export async function PUT(request: NextRequest) {
  let body: { id?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const [ws] = await userDb
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1);
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  await setAppSetting(ACTIVE_WORKSPACE_SETTING_KEY, String(id));
  return NextResponse.json({ ok: true });
}
