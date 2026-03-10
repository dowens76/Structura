import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
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
  const [
    pbRows, charRows, charRefRows, speechRows,
    wtRows, wtrRows, liRows, passRows, clRelRows, waRows, wfRows,
    transRows, tvRows,
  ] = await Promise.all([
    db.select().from(paragraphBreaks),
    db.select().from(characters),
    db.select().from(characterRefs),
    db.select().from(speechSections),
    db.select().from(wordTags),
    db.select().from(wordTagRefs),
    db.select().from(lineIndents),
    db.select().from(passages),
    db.select().from(clauseRelationships),
    db.select().from(wordArrows),
    db.select().from(wordFormatting),
    db.select().from(translations),
    db.select().from(translationVerses),
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
    // ── Delete all existing data, children before parents ─────────────────
    await db.delete(wordFormatting);
    await db.delete(wordArrows);
    await db.delete(clauseRelationships);
    await db.delete(lineIndents);
    await db.delete(passages);
    await db.delete(wordTagRefs);
    await db.delete(wordTags);
    await db.delete(characterRefs);
    await db.delete(speechSections);
    await db.delete(characters);
    await db.delete(paragraphBreaks);
    await db.delete(translationVerses);
    await db.delete(translations);

    // ── Re-insert from backup, parents before children ─────────────────────
    // paragraphBreaks
    if (data.paragraphBreaks?.length) {
      for (const batch of chunk(data.paragraphBreaks as typeof paragraphBreaks.$inferInsert[], BATCH)) {
        await db.insert(paragraphBreaks).values(batch);
      }
    }

    // characters
    if (data.characters?.length) {
      for (const batch of chunk(data.characters as typeof characters.$inferInsert[], BATCH)) {
        await db.insert(characters).values(batch);
      }
    }

    // characterRefs (FK → characters)
    if (data.characterRefs?.length) {
      for (const batch of chunk(data.characterRefs as typeof characterRefs.$inferInsert[], BATCH)) {
        await db.insert(characterRefs).values(batch);
      }
    }

    // speechSections (FK → characters)
    if (data.speechSections?.length) {
      for (const batch of chunk(data.speechSections as typeof speechSections.$inferInsert[], BATCH)) {
        await db.insert(speechSections).values(batch);
      }
    }

    // wordTags
    if (data.wordTags?.length) {
      for (const batch of chunk(data.wordTags as typeof wordTags.$inferInsert[], BATCH)) {
        await db.insert(wordTags).values(batch);
      }
    }

    // wordTagRefs (FK → wordTags)
    if (data.wordTagRefs?.length) {
      for (const batch of chunk(data.wordTagRefs as typeof wordTagRefs.$inferInsert[], BATCH)) {
        await db.insert(wordTagRefs).values(batch);
      }
    }

    // lineIndents
    if (data.lineIndents?.length) {
      for (const batch of chunk(data.lineIndents as typeof lineIndents.$inferInsert[], BATCH)) {
        await db.insert(lineIndents).values(batch);
      }
    }

    // passages
    if (data.passages?.length) {
      for (const batch of chunk(data.passages as typeof passages.$inferInsert[], BATCH)) {
        await db.insert(passages).values(batch);
      }
    }

    // clauseRelationships
    if (data.clauseRelationships?.length) {
      for (const batch of chunk(data.clauseRelationships as typeof clauseRelationships.$inferInsert[], BATCH)) {
        await db.insert(clauseRelationships).values(batch);
      }
    }

    // wordArrows
    if (data.wordArrows?.length) {
      for (const batch of chunk(data.wordArrows as typeof wordArrows.$inferInsert[], BATCH)) {
        await db.insert(wordArrows).values(batch);
      }
    }

    // wordFormatting
    if (data.wordFormatting?.length) {
      for (const batch of chunk(data.wordFormatting as typeof wordFormatting.$inferInsert[], BATCH)) {
        await db.insert(wordFormatting).values(batch);
      }
    }

    // translations — createdAt is stored as a Unix timestamp integer but Drizzle
    // returns it as a Date (which JSON.stringify converts to an ISO string).
    // Convert it back to a Date object before reinserting.
    if (data.translations?.length) {
      const rows = data.translations.map((r) => ({
        ...r,
        createdAt: r.createdAt ? new Date(r.createdAt as string | number) : undefined,
      })) as typeof translations.$inferInsert[];
      for (const batch of chunk(rows, BATCH)) {
        await db.insert(translations).values(batch);
      }
    }

    // translationVerses (FK → translations) — potentially 40K+ rows, batched
    if (data.translationVerses?.length) {
      for (const batch of chunk(data.translationVerses as typeof translationVerses.$inferInsert[], BATCH)) {
        await db.insert(translationVerses).values(batch);
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
