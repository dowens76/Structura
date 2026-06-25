import { NextRequest, NextResponse } from "next/server";
import { userDb } from "@/lib/db";
import { bookmarks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// GET /api/bookmarks — returns all bookmarks for the active workspace
export async function GET() {
  const workspaceId = await getActiveWorkspaceId();
  const rows = await userDb
    .select()
    .from(bookmarks)
    .where(eq(bookmarks.workspaceId, workspaceId));
  return NextResponse.json(rows);
}

// POST /api/bookmarks — upsert a bookmark
// Body: { id: string; label: string; href: string; translations: BookmarkView | string[]; createdAt: number }
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { id?: string; label?: string; href?: string; translations?: unknown; createdAt?: number };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { id, label = "", href = "", translations = [], createdAt = Date.now() } = body;
  if (!id || !href) return NextResponse.json({ error: "id and href required" }, { status: 400 });

  const translationsJson = JSON.stringify(translations);
  await userDb
    .insert(bookmarks)
    .values({ id, workspaceId, label, href, translations: translationsJson, createdAt })
    .onConflictDoUpdate({
      target: bookmarks.id,
      set: { label, href, translations: translationsJson, createdAt },
    });
  return NextResponse.json({ ok: true });
}

// DELETE /api/bookmarks?id=... — delete a single bookmark
export async function DELETE(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await userDb
    .delete(bookmarks)
    .where(and(eq(bookmarks.id, id), eq(bookmarks.workspaceId, workspaceId)));
  return NextResponse.json({ ok: true });
}
