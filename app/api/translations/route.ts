import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { translations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// PATCH /api/translations
// Body: { id: number; language: string | null }
// Updates the language field of a single translation record.
export async function PATCH(request: NextRequest) {
  let body: { id?: number; language?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id, language } = body;
  if (id == null) {
    return NextResponse.json({ error: "Missing field: id" }, { status: 400 });
  }

  await db
    .update(translations)
    .set({ language: language ?? null })
    .where(eq(translations.id, id));

  return NextResponse.json({ ok: true });
}
