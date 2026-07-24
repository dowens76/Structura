import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { userDb } from "@/lib/db";
import { wordTags } from "@/lib/db/user-schema";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// GET /api/word-tags/by-name?name=X
// Returns every underlying word_tags row sharing that name — the Manage
// Lists page merges same-named rows (possibly across several books) into one
// listing, but each row's own color/type/corpus is edited individually here.
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");
  if (!name) return NextResponse.json({ error: "Missing name param" }, { status: 400 });

  const tags = await userDb
    .select()
    .from(wordTags)
    .where(and(eq(wordTags.workspaceId, workspaceId), eq(wordTags.name, name)));

  return NextResponse.json({ tags });
}
