import { NextRequest, NextResponse } from "next/server";
import { userDb } from "@/lib/db";
import { translations } from "@/lib/db/schema";
import { asc, eq, sql } from "drizzle-orm";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// GET /api/translations
export async function GET() {
  const rows = await userDb
    .select({
      id: translations.id,
      name: translations.name,
      abbreviation: translations.abbreviation,
      language: translations.language,
    })
    .from(translations)
    .orderBy(asc(translations.sortOrder), asc(translations.abbreviation));

  return NextResponse.json(rows);
}

// POST /api/translations
// Body: { name, abbreviation, language? }
// Creates a new (empty) translation.
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { name?: string; abbreviation?: string; language?: string | null };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = body.name?.trim();
  const abbreviation = body.abbreviation?.trim().toUpperCase();
  if (!name || !abbreviation) {
    return NextResponse.json({ error: "name and abbreviation are required" }, { status: 400 });
  }

  // Translations are shared across workspaces (see getTranslations in lib/db/queries.ts),
  // so the abbreviation must be unique across all workspaces, not just this one.
  const existing = await userDb
    .select({ id: translations.id })
    .from(translations)
    .where(eq(translations.abbreviation, abbreviation));
  if (existing.length > 0) {
    return NextResponse.json(
      { error: `A translation with abbreviation "${abbreviation}" already exists.` },
      { status: 409 }
    );
  }

  // New translations go at the end of the display order.
  const [{ maxOrder }] = await userDb
    .select({ maxOrder: sql<number>`coalesce(max(${translations.sortOrder}), -1)` })
    .from(translations);

  const result = await userDb
    .insert(translations)
    .values({ workspaceId, name, abbreviation, language: body.language ?? null, sortOrder: maxOrder + 1 })
    .returning({ id: translations.id });

  return NextResponse.json({ id: result[0].id });
}

// PATCH /api/translations
// Body: { id, name?, abbreviation?, language? }
// Updates editable fields of a translation. Translations are shared across
// workspaces (see getTranslations in lib/db/queries.ts), so edits aren't
// restricted to the workspace that originally created the row.
export async function PATCH(request: NextRequest) {
  let body: { id?: number; name?: string; abbreviation?: string; language?: string | null };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id } = body;
  if (id == null) return NextResponse.json({ error: "Missing field: id" }, { status: 400 });

  const patch: Partial<{ name: string; abbreviation: string; language: string | null }> = {};
  if (body.name      != null) patch.name        = body.name.trim();
  if (body.abbreviation != null) patch.abbreviation = body.abbreviation.trim().toUpperCase();
  if ("language" in body)     patch.language    = body.language ?? null;

  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

  if (patch.abbreviation != null) {
    const existing = await userDb
      .select({ id: translations.id })
      .from(translations)
      .where(eq(translations.abbreviation, patch.abbreviation));
    if (existing.some((row) => row.id !== id)) {
      return NextResponse.json(
        { error: `A translation with abbreviation "${patch.abbreviation}" already exists.` },
        { status: 409 }
      );
    }
  }

  await userDb
    .update(translations)
    .set(patch)
    .where(eq(translations.id, id));

  return NextResponse.json({ ok: true });
}

// DELETE /api/translations?id=N
// Translations are shared across workspaces (see PATCH above), so deletion
// isn't restricted to the workspace that originally created the row.
export async function DELETE(request: NextRequest) {
  const id = parseInt(request.nextUrl.searchParams.get("id") ?? "", 10);
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await userDb
    .delete(translations)
    .where(eq(translations.id, id));

  return NextResponse.json({ ok: true });
}
