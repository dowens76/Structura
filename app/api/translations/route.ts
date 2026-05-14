import { NextRequest, NextResponse } from "next/server";
import { userDb } from "@/lib/db";
import { translations } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// GET /api/translations
// Returns all translations with id, name, abbreviation, and language.
export async function GET() {
  const rows = await userDb
    .select({
      id: translations.id,
      name: translations.name,
      abbreviation: translations.abbreviation,
      language: translations.language,
    })
    .from(translations)
    .orderBy(asc(translations.abbreviation));

  return NextResponse.json(rows);
}

// PATCH /api/translations
// Body: { id: number; language: string | null }
// Updates the language field of a single translation record.
export async function PATCH(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
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

  await userDb
    .update(translations)
    .set({ language: language ?? null })
    .where(and(eq(translations.id, id), eq(translations.workspaceId, workspaceId)));

  return NextResponse.json({ ok: true });
}
