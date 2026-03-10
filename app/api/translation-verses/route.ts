import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { translationVerses } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// PATCH /api/translation-verses
// Body: { id: number, text: string }
// Updates the text of a single translation verse record.
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

  await db
    .update(translationVerses)
    .set({ text })
    .where(eq(translationVerses.id, id));

  return NextResponse.json({ ok: true });
}
