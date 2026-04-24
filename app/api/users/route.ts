import { NextRequest, NextResponse } from "next/server";
import { userDb } from "@/lib/db";
import { users, workspaces } from "@/lib/db/user-schema";
import { asc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

// GET /api/users — list all users
export async function GET() {
  const rows = await userDb.select().from(users).orderBy(asc(users.id));
  return NextResponse.json({ users: rows });
}

// POST /api/users — create a new user (and optionally a default workspace)
// Body: { name, email }
export async function POST(request: NextRequest) {
  let body: { name?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, email } = body;
  if (!name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: "name and email are required" }, { status: 400 });
  }

  // Check for duplicate email
  const existing = await userDb
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.trim()))
    .limit(1);
  if (existing.length > 0) {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }

  const [user] = await userDb
    .insert(users)
    .values({ name: name.trim(), email: email.trim() })
    .returning();

  // Auto-create a "Default" workspace for the new user
  const [workspace] = await userDb
    .insert(workspaces)
    .values({ userId: user.id, name: "Default" })
    .returning();

  return NextResponse.json({ user, workspace }, { status: 201 });
}
