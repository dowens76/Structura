import { NextRequest, NextResponse } from "next/server";
import { eq, and, inArray, or, asc, sql } from "drizzle-orm";
import { userDb, sourceDb } from "@/lib/db";
import {
  wordTags,
  wordTagRefs,
  characters,
  characterRefs,
  translations,
} from "@/lib/db/user-schema";
import { books } from "@/lib/db/source-schema";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { csvField } from "@/lib/utils/csv";
import { resolveOccurrenceRefs, type RawOccurrenceRef } from "@/lib/db/concept-occurrences";

export const dynamic = "force-dynamic";

// ─── GET /api/export/tag-lists ────────────────────────────────────────────────
// Returns all word-tag groups and character groups for the picker UI, plus
// available translations and book list.

export async function GET() {
  const workspaceId = await getActiveWorkspaceId();

  const [allTags, allChars, allTranslations, allBooks] = await Promise.all([
    userDb.select().from(wordTags).where(eq(wordTags.workspaceId, workspaceId)).orderBy(asc(wordTags.name)),
    userDb.select().from(characters).where(eq(characters.workspaceId, workspaceId)).orderBy(asc(characters.name)),
    userDb.select().from(translations).orderBy(asc(translations.abbreviation)),
    sourceDb.select({ osisCode: books.osisCode, name: books.name, bookNumber: books.bookNumber, testament: books.testament })
      .from(books).orderBy(asc(books.bookNumber)),
  ]);

  // Count refs per tag
  const tagCounts = await userDb
    .select({ tagId: wordTagRefs.tagId, count: sql<number>`count(*)` })
    .from(wordTagRefs)
    .where(eq(wordTagRefs.workspaceId, workspaceId))
    .groupBy(wordTagRefs.tagId);
  const tagCountMap = new Map(tagCounts.map((r) => [r.tagId, r.count]));

  // Count refs per character (character1Id)
  const charCounts = await userDb
    .select({ charId: characterRefs.character1Id, count: sql<number>`count(*)` })
    .from(characterRefs)
    .where(eq(characterRefs.workspaceId, workspaceId))
    .groupBy(characterRefs.character1Id);
  const charCountMap = new Map(charCounts.map((r) => [r.charId, r.count]));

  // Group tags by name
  const tagGroupMap = new Map<string, { name: string; type: string; books: string[]; color: string; count: number }>();
  for (const tag of allTags) {
    const count = tagCountMap.get(tag.id) ?? 0;
    const existing = tagGroupMap.get(tag.name);
    if (existing) {
      if (!existing.books.includes(tag.book)) existing.books.push(tag.book);
      existing.count += count;
    } else {
      tagGroupMap.set(tag.name, { name: tag.name, type: tag.type, books: [tag.book], color: tag.color, count });
    }
  }

  // Group characters by name
  const charGroupMap = new Map<string, { name: string; books: string[]; color: string; count: number }>();
  for (const char of allChars) {
    const count = charCountMap.get(char.id) ?? 0;
    const existing = charGroupMap.get(char.name);
    if (existing) {
      if (!existing.books.includes(char.book)) existing.books.push(char.book);
      existing.count += count;
    } else {
      charGroupMap.set(char.name, { name: char.name, books: [char.book], color: char.color, count });
    }
  }

  return NextResponse.json({
    wordTagGroups: Array.from(tagGroupMap.values()),
    characterGroups: Array.from(charGroupMap.values()),
    translations: allTranslations,
    books: allBooks,
  });
}

// ─── POST /api/export/tag-lists ───────────────────────────────────────────────
// Generates a CSV for a single named tag or character.
// Body: { name: string; type: "wordTag" | "character"; bookFilter?: string[] }
// Returns: text/csv

export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();

  let body: { name?: string; type?: string; bookFilter?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, type, bookFilter } = body;
  if (!name || !type) {
    return NextResponse.json({ error: "Missing name or type" }, { status: 400 });
  }

  // All translations (columns in the CSV)
  const allTranslations = await userDb.select().from(translations).orderBy(asc(translations.abbreviation));

  // ── Collect raw refs ──────────────────────────────────────────────────────

  let refs: RawOccurrenceRef[] = [];

  if (type === "wordTag") {
    // book='*' means corpus-wide (saved search list) — never filter those by bookFilter
    const conditions = [eq(wordTags.workspaceId, workspaceId), eq(wordTags.name, name)];
    if (bookFilter && bookFilter.length > 0) {
      conditions.push(or(inArray(wordTags.book, bookFilter), eq(wordTags.book, "*"))!);
    }
    const matchingTags = await userDb.select({ id: wordTags.id }).from(wordTags).where(and(...conditions));
    if (matchingTags.length > 0) {
      const tagIds = matchingTags.map((t) => t.id);
      const refConditions = [eq(wordTagRefs.workspaceId, workspaceId), inArray(wordTagRefs.tagId, tagIds)];
      // For refs, bookFilter still applies (each ref has the actual book)
      if (bookFilter && bookFilter.length > 0) refConditions.push(inArray(wordTagRefs.book, bookFilter));
      const rows = await userDb.select({
        wordId: wordTagRefs.wordId, book: wordTagRefs.book,
        chapter: wordTagRefs.chapter, textSource: wordTagRefs.textSource,
      }).from(wordTagRefs).where(and(...refConditions));
      refs = rows;
    }
  } else if (type === "character") {
    const conditions = [eq(characters.workspaceId, workspaceId), eq(characters.name, name)];
    if (bookFilter && bookFilter.length > 0) conditions.push(inArray(characters.book, bookFilter));
    const matchingChars = await userDb.select({ id: characters.id }).from(characters).where(and(...conditions));
    if (matchingChars.length > 0) {
      const charIds = matchingChars.map((c) => c.id);
      const refConditions = [
        eq(characterRefs.workspaceId, workspaceId),
        or(inArray(characterRefs.character1Id, charIds), inArray(characterRefs.character2Id, charIds))!,
      ];
      if (bookFilter && bookFilter.length > 0) refConditions.push(inArray(characterRefs.book, bookFilter));
      const rows = await userDb.select({
        wordId: characterRefs.wordId, book: characterRefs.book,
        chapter: characterRefs.chapter, textSource: characterRefs.textSource,
      }).from(characterRefs).where(and(...refConditions));
      refs = rows;
    }
  }

  // ── Resolve refs into display-ready occurrences ───────────────────────────

  const occurrences = await resolveOccurrenceRefs(refs);

  // The CSV lists one row per distinct verse (not per word occurrence) — fold
  // multiple tagged words in the same verse into a single row.
  const verseRowMap = new Map<string, (typeof occurrences)[number]>();
  for (const occ of occurrences) {
    if (!verseRowMap.has(occ.osisRef)) verseRowMap.set(occ.osisRef, occ);
  }
  const uniqueRefs = Array.from(verseRowMap.values());

  // ── Build CSV ──────────────────────────────────────────────────────────────

  const header = ["Reference", "Source Text", ...allTranslations.map((t) => t.abbreviation)].map(csvField).join(",");

  const rows = uniqueRefs.map((ref) => {
    const transCols = allTranslations.map((t) => ref.translationTexts.get(t.id) ?? "");
    return [ref.reference, ref.sourceText, ...transCols].map(csvField).join(",");
  });

  const csv = [header, ...rows].join("\n");
  const safeFilename = name.replace(/[^\w\- ]/g, "_");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="List-${safeFilename}.csv"`,
    },
  });
}
