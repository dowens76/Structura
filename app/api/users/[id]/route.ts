import { NextRequest, NextResponse } from "next/server";
import { userDb } from "@/lib/db";
import { users } from "@/lib/db/user-schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// PATCH /api/users/[id] — update name and/or email
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: { name?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: { name?: string; email?: string } = {};
  if (body.name?.trim()) updates.name = body.name.trim();
  if (body.email?.trim()) updates.email = body.email.trim();

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [user] = await userDb
    .update(users)
    .set(updates)
    .where(eq(users.id, id))
    .returning();

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json({ user });
}
