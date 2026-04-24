import { NextRequest, NextResponse } from "next/server";
import { userDb } from "@/lib/db";
import { users, workspaces } from "@/lib/db/user-schema";
import { asc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

// GET /api/workspaces?userId=1 — list all workspaces for a user
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userIdStr = searchParams.get("userId");
  const userId = parseInt(userIdStr ?? "", 10);

  if (isNaN(userId)) {
    return NextResponse.json({ error: "Missing or invalid userId" }, { status: 400 });
  }

  const rows = await userDb
    .select()
    .from(workspaces)
    .where(eq(workspaces.userId, userId))
    .orderBy(asc(workspaces.id));

  return NextResponse.json({ workspaces: rows });
}

// POST /api/workspaces — create a new workspace
// Body: { userId, name }
export async function POST(request: NextRequest) {
  let body: { userId?: number; name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId, name } = body;
  if (!userId || !name?.trim()) {
    return NextResponse.json({ error: "userId and name are required" }, { status: 400 });
  }

  // Verify user exists
  const user = await userDb
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (user.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const [workspace] = await userDb
    .insert(workspaces)
    .values({ userId, name: name.trim() })
    .returning();

  return NextResponse.json({ workspace }, { status: 201 });
}
