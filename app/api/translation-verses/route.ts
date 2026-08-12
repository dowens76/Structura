import { NextRequest, NextResponse } from "next/server";
import { userDb } from "@/lib/db";
import { translationVerses } from "@/lib/db/schema";
import { getBook } from "@/lib/db/queries";
import { eq } from "drizzle-orm";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// PATCH /api/translation-verses
// Body: { id: number, text: string }
// Updates the text of a single translation verse record.
//
// Translations (and their verse text) are a shared resource visible from
// every workspace — getTranslations()/getTranslationVerses() both ignore
// workspaceId entirely, by design, so a translation created under one
// workspace still reads/renders in every other workspace. This PATCH must
// not scope its WHERE by the *currently active* workspace: a row's
// workspace_id reflects whichever workspace originally created it (often
// not the one now editing it), so filtering on it made the UPDATE match
// zero rows whenever those differed — it silently no-op'd while still
// returning { ok: true }, so edits appeared to save but never persisted.
export async function PATCH(request: NextRequest) {
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
    .where(eq(translationVerses.id, id));

  return NextResponse.json({ ok: true });
}

// POST /api/translation-verses
// Body: { translationId, book, chapter, verse, text }
// Creates a new translation verse record and returns its id.
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { translationId?: number; book?: string; chapter?: number; verse?: number; text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { translationId, book, chapter, verse, text } = body;
  if (translationId == null || !book || chapter == null || verse == null || text == null) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const bookRecord = await getBook(book);
  if (!bookRecord) return NextResponse.json({ error: "Book not found" }, { status: 404 });

  const result = await userDb
    .insert(translationVerses)
    .values({
      workspaceId,
      translationId,
      osisRef: `${book}.${chapter}.${verse}`,
      bookId: bookRecord.id,
      chapter,
      verse,
      text,
    })
    .returning({ id: translationVerses.id });

  return NextResponse.json({ id: result[0].id });
}
