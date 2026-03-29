import { NextRequest, NextResponse } from "next/server";
import { userDb } from "@/lib/db";
import {
  paragraphBreaks,
  characters,
  characterRefs,
  speechSections,
  wordTags,
  wordTagRefs,
  lineIndents,
  passages,
  clauseRelationships,
  wordArrows,
  wordFormatting,
  translations,
  translationVerses,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getActiveWorkspaceId } from "@/lib/workspace";

// Split an array into chunks of at most `size` elements.
// SQLite has a parameter limit of 999 per statement; 500-row batches stay well under it.
function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

const BATCH = 500;

// ── GET /api/backup ────────────────────────────────────────────────────────
// Returns a downloadable JSON file containing all user annotation and
// translation data (everything except the source texts books/words/verses).
export async function GET() {
  const workspaceId = await getActiveWorkspaceId();
  const [
    pbRows, charRows, charRefRows, speechRows,
    wtRows, wtrRows, liRows, passRows, clRelRows, waRows, wfRows,
    transRows, tvRows,
  ] = await Promise.all([
    userDb.select().from(paragraphBreaks).where(eq(paragraphBreaks.workspaceId, workspaceId)),
    userDb.select().from(characters).where(eq(characters.workspaceId, workspaceId)),
    userDb.select().from(characterRefs).where(eq(characterRefs.workspaceId, workspaceId)),
    userDb.select().from(speechSections).where(eq(speechSections.workspaceId, workspaceId)),
    userDb.select().from(wordTags).where(eq(wordTags.workspaceId, workspaceId)),
    userDb.select().from(wordTagRefs).where(eq(wordTagRefs.workspaceId, workspaceId)),
    userDb.select().from(lineIndents).where(eq(lineIndents.workspaceId, workspaceId)),
    userDb.select().from(passages).where(eq(passages.workspaceId, workspaceId)),
    userDb.select().from(clauseRelationships).where(eq(clauseRelationships.workspaceId, workspaceId)),
    userDb.select().from(wordArrows).where(eq(wordArrows.workspaceId, workspaceId)),
    userDb.select().from(wordFormatting).where(eq(wordFormatting.workspaceId, workspaceId)),
    userDb.select().from(translations).where(eq(translations.workspaceId, workspaceId)),
    userDb.select().from(translationVerses).where(eq(translationVerses.workspaceId, workspaceId)),
  ]);

  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      paragraphBreaks: pbRows,
      characters: charRows,
      characterRefs: charRefRows,
      speechSections: speechRows,
      wordTags: wtRows,
      wordTagRefs: wtrRows,
      lineIndents: liRows,
      passages: passRows,
      clauseRelationships: clRelRows,
      wordArrows: waRows,
      wordFormatting: wfRows,
      translations: transRows,
      translationVerses: tvRows,
    },
  };

  const date = new Date().toISOString().slice(0, 10);
  const json = JSON.stringify(backup);

  return new Response(json, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="structura-backup-${date}.json"`,
    },
  });
}

// ── POST /api/backup ───────────────────────────────────────────────────────
// Restores all user annotation and translation data from a previously exported
// backup JSON. All existing data in the annotation tables is cleared first.
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let backup: unknown;
  try {
    backup = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body." }, { status: 400 });
  }

  if (
    typeof backup !== "object" || backup === null ||
    !("version" in backup) || !("data" in backup) ||
    typeof (backup as { data: unknown }).data !== "object"
  ) {
    return NextResponse.json({ error: "Invalid backup format — missing version or data fields." }, { status: 400 });
  }

  type AnyRow = Record<string, unknown>;
  const data = (backup as { data: Record<string, AnyRow[]> }).data;

  try {
    // ── Delete all existing data for this workspace, children before parents ─
    await userDb.delete(wordFormatting).where(eq(wordFormatting.workspaceId, workspaceId));
    await userDb.delete(wordArrows).where(eq(wordArrows.workspaceId, workspaceId));
    await userDb.delete(clauseRelationships).where(eq(clauseRelationships.workspaceId, workspaceId));
    await userDb.delete(lineIndents).where(eq(lineIndents.workspaceId, workspaceId));
    await userDb.delete(passages).where(eq(passages.workspaceId, workspaceId));
    await userDb.delete(wordTagRefs).where(eq(wordTagRefs.workspaceId, workspaceId));
    await userDb.delete(wordTags).where(eq(wordTags.workspaceId, workspaceId));
    await userDb.delete(characterRefs).where(eq(characterRefs.workspaceId, workspaceId));
    await userDb.delete(speechSections).where(eq(speechSections.workspaceId, workspaceId));
    await userDb.delete(characters).where(eq(characters.workspaceId, workspaceId));
    await userDb.delete(paragraphBreaks).where(eq(paragraphBreaks.workspaceId, workspaceId));
    await userDb.delete(translationVerses).where(eq(translationVerses.workspaceId, workspaceId));
    await userDb.delete(translations).where(eq(translations.workspaceId, workspaceId));

    // ── Re-insert from backup, parents before children ─────────────────────
    // paragraphBreaks
    if (data.paragraphBreaks?.length) {
      const rows = (data.paragraphBreaks as typeof paragraphBreaks.$inferInsert[]).map((r) => ({ ...r, workspaceId }));
      for (const batch of chunk(rows, BATCH)) {
        await userDb.insert(paragraphBreaks).values(batch);
      }
    }

    // characters
    if (data.characters?.length) {
      const rows = (data.characters as typeof characters.$inferInsert[]).map((r) => ({ ...r, workspaceId }));
      for (const batch of chunk(rows, BATCH)) {
        await userDb.insert(characters).values(batch);
      }
    }

    // characterRefs (FK → characters)
    if (data.characterRefs?.length) {
      const rows = (data.characterRefs as typeof characterRefs.$inferInsert[]).map((r) => ({ ...r, workspaceId }));
      for (const batch of chunk(rows, BATCH)) {
        await userDb.insert(characterRefs).values(batch);
      }
    }

    // speechSections (FK → characters)
    if (data.speechSections?.length) {
      const rows = (data.speechSections as typeof speechSections.$inferInsert[]).map((r) => ({ ...r, workspaceId }));
      for (const batch of chunk(rows, BATCH)) {
        await userDb.insert(speechSections).values(batch);
      }
    }

    // wordTags
    if (data.wordTags?.length) {
      const rows = (data.wordTags as typeof wordTags.$inferInsert[]).map((r) => ({ ...r, workspaceId }));
      for (const batch of chunk(rows, BATCH)) {
        await userDb.insert(wordTags).values(batch);
      }
    }

    // wordTagRefs (FK → wordTags)
    if (data.wordTagRefs?.length) {
      const rows = (data.wordTagRefs as typeof wordTagRefs.$inferInsert[]).map((r) => ({ ...r, workspaceId }));
      for (const batch of chunk(rows, BATCH)) {
        await userDb.insert(wordTagRefs).values(batch);
      }
    }

    // lineIndents
    if (data.lineIndents?.length) {
      const rows = (data.lineIndents as typeof lineIndents.$inferInsert[]).map((r) => ({ ...r, workspaceId }));
      for (const batch of chunk(rows, BATCH)) {
        await userDb.insert(lineIndents).values(batch);
      }
    }

    // passages
    if (data.passages?.length) {
      const rows = (data.passages as typeof passages.$inferInsert[]).map((r) => ({ ...r, workspaceId }));
      for (const batch of chunk(rows, BATCH)) {
        await userDb.insert(passages).values(batch);
      }
    }

    // clauseRelationships
    if (data.clauseRelationships?.length) {
      const rows = (data.clauseRelationships as typeof clauseRelationships.$inferInsert[]).map((r) => ({ ...r, workspaceId }));
      for (const batch of chunk(rows, BATCH)) {
        await userDb.insert(clauseRelationships).values(batch);
      }
    }

    // wordArrows
    if (data.wordArrows?.length) {
      const rows = (data.wordArrows as typeof wordArrows.$inferInsert[]).map((r) => ({ ...r, workspaceId }));
      for (const batch of chunk(rows, BATCH)) {
        await userDb.insert(wordArrows).values(batch);
      }
    }

    // wordFormatting
    if (data.wordFormatting?.length) {
      const rows = (data.wordFormatting as typeof wordFormatting.$inferInsert[]).map((r) => ({ ...r, workspaceId }));
      for (const batch of chunk(rows, BATCH)) {
        await userDb.insert(wordFormatting).values(batch);
      }
    }

    // translations — createdAt is stored as a Unix timestamp integer but Drizzle
    // returns it as a Date (which JSON.stringify converts to an ISO string).
    // Convert it back to a Date object before reinserting.
    if (data.translations?.length) {
      const rows = data.translations.map((r) => ({
        ...r,
        workspaceId,
        createdAt: r.createdAt ? new Date(r.createdAt as string | number) : undefined,
      })) as typeof translations.$inferInsert[];
      for (const batch of chunk(rows, BATCH)) {
        await userDb.insert(translations).values(batch);
      }
    }

    // translationVerses (FK → translations) — potentially 40K+ rows, batched
    if (data.translationVerses?.length) {
      const rows = (data.translationVerses as typeof translationVerses.$inferInsert[]).map((r) => ({ ...r, workspaceId }));
      for (const batch of chunk(rows, BATCH)) {
        await userDb.insert(translationVerses).values(batch);
      }
    }

    // Return row counts for each restored table
    const counts = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])
    );
    return NextResponse.json({ ok: true, counts });

  } catch (err) {
    console.error("[backup restore] failed:", err);
    return NextResponse.json(
      { error: "Restore failed — your database may be in a partial state. Retry the restore from the backup file." },
      { status: 500 }
    );
  }
}
