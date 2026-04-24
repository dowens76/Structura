import { NextRequest, NextResponse } from "next/server";
import { userDb } from "@/lib/db";
import { translationVerses } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// PATCH /api/translation-verses
// Body: { id: number, text: string }
// Updates the text of a single translation verse record.
export async function PATCH(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { id?: number; text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id, text } = body;
  if (id == null || text == null) {
    return NextResponse.json({ error: "Missing fields: id, text" }, { status: 400 });
  }

  await userDb
    .update(translationVerses)
    .set({ text })
    .where(and(eq(translationVerses.id, id), eq(translationVerses.workspaceId, workspaceId)));

  return NextResponse.json({ ok: true });
}
