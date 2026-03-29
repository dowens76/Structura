import { NextRequest, NextResponse } from "next/server";
import { userDb } from "@/lib/db";
import { notes } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getActiveWorkspaceId } from "@/lib/workspace";

// GET /api/notes?keys=verse:Gen.1.1,chapter:Gen.1,...
// Returns: { [key]: { content: string; updatedAt: string } }
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const keysParam = searchParams.get("keys");
  if (!keysParam) {
    return NextResponse.json({});
  }
  const keys = keysParam.split(",").filter(Boolean);
  if (keys.length === 0) return NextResponse.json({});

  const rows = await userDb
    .select()
    .from(notes)
    .where(and(eq(notes.workspaceId, workspaceId), inArray(notes.key, keys)));

  const result: Record<string, { content: string; updatedAt: string | null }> = {};
  for (const row of rows) {
    result[row.key] = { content: row.content, updatedAt: row.updatedAt };
  }
  return NextResponse.json(result);
}

// PUT /api/notes
// Body: { key: string; noteType: string; content: string; book?: string; chapter?: number }
export async function PUT(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { key?: string; noteType?: string; content?: string; book?: string; chapter?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { key, noteType, content, book, chapter } = body;
  if (!key || !noteType || content === undefined) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  await userDb
    .insert(notes)
    .values({
      key,
      noteType,
      content,
      book: book ?? null,
      chapter: chapter ?? null,
      updatedAt: new Date().toISOString(),
      workspaceId,
    })
    .onConflictDoUpdate({
      target: [notes.workspaceId, notes.key],
      set: {
        content,
        updatedAt: new Date().toISOString(),
      },
    });

  return NextResponse.json({ ok: true });
}
