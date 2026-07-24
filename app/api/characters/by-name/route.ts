import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { userDb } from "@/lib/db";
import { characters } from "@/lib/db/user-schema";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// GET /api/characters/by-name?name=X
// Returns every underlying characters row sharing that name — mirrors
// /api/word-tags/by-name; the Manage Lists page merges same-named rows
// (possibly across several books) into one listing, but each row's own
// color/corpus is edited individually here.
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");
  if (!name) return NextResponse.json({ error: "Missing name param" }, { status: 400 });

  const chars = await userDb
    .select()
    .from(characters)
    .where(and(eq(characters.workspaceId, workspaceId), eq(characters.name, name)));

  return NextResponse.json({ characters: chars });
}
