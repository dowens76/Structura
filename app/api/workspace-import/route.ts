import { NextRequest, NextResponse } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
import { userDb } from "@/lib/db";
import {
  translations,
  translationVerses,
  paragraphBreaks,
  sceneBreaks,
  lineAnnotations,
  wordTags,
  wordTagRefs,
  wordFormatting,
  characters,
  characterRefs,
  speechSections,
  lineIndents,
  wordArrows,
  clauseRelationships,
  rstRelations,
  rstCustomTypes,
  notes,
  passages,
} from "@/lib/db/user-schema";
import { getActiveWorkspaceId } from "@/lib/workspace";

// ─── Types ──────────────────────────────────────────────────────────────────

type Chapter = { book: string; chapter: number };

type Scope =
  | { type: "chapter"; book: string; chapter: number }
  | { type: "passage"; passageId: number };

type DataType =
  | "translationVerses"
  | "sectionBreaks"
  | "lineAnnotations"
  | "wordTags"
  | "wordFormatting"
  | "characters"
  | "lineIndents"
  | "wordArrows"
  | "clauseRelationships"
  | "rstRelations"
  | "notes"
  | "passages";

interface RequestBody {
  sourceWorkspaceId: number;
  scope: Scope;
  dataTypes: DataType[];
}

// ─── Scope resolution ────────────────────────────────────────────────────────

async function resolveScope(scope: Scope, src: number): Promise<Chapter[]> {
  if (scope.type === "chapter") {
    return [{ book: scope.book, chapter: scope.chapter }];
  }

  // Passage scope: look up the passage in the source workspace
  const passageRows = await userDb
    .select()
    .from(passages)
    .where(
      and(
        eq(passages.workspaceId, src),
        eq(passages.id, scope.passageId)
      )
    );

  if (passageRows.length === 0) {
    return [];
  }

  const passage = passageRows[0];
  const chapters: Chapter[] = [];
  for (let ch = passage.startChapter; ch <= passage.endChapter; ch++) {
    chapters.push({ book: passage.book, chapter: ch });
  }
  return chapters;
}

// ─── Scope filter helpers ────────────────────────────────────────────────────

/**
 * Build a Drizzle WHERE condition for rows that match any of the given chapters.
 * The table must have .workspaceId, .book, and .chapter columns.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chapterCondition<T extends { workspaceId: any; book: any; chapter: any }>(
  table: T,
  workspaceId: number,
  chapters: Chapter[]
) {
  if (chapters.length === 0) return null;

  if (chapters.length === 1) {
    return and(
      eq(table.workspaceId, workspaceId),
      eq(table.book, chapters[0].book),
      eq(table.chapter, chapters[0].chapter)
    );
  }

  // Group chapters by book (in practice usually one book, but handle multi-book)
  const byBook = new Map<string, number[]>();
  for (const { book, chapter } of chapters) {
    if (!byBook.has(book)) byBook.set(book, []);
    byBook.get(book)!.push(chapter);
  }

  const books = [...byBook.keys()];
  if (books.length === 1) {
    const book = books[0];
    return and(
      eq(table.workspaceId, workspaceId),
      eq(table.book, book),
      inArray(table.chapter, byBook.get(book)!)
    );
  }

  // Multiple books: fetch all for the workspace filtered by book set and chapter sets
  // We use OR conditions per book. Drizzle's `or` isn't imported, so we use inArray on
  // chapter across the full set (acceptable because cross-book chapter overlap is fine
  // given we also filter by book below via a second pass — but to keep it simple and
  // correct we use the broadest safe filter and let the insert be idempotent).
  // For correctness with multiple books: return workspace-level filter and post-filter.
  return eq(table.workspaceId, workspaceId);
}

/** Filter fetched rows to only those matching the chapters list. */
function filterByChapters<T extends { book: string; chapter: number }>(
  rows: T[],
  chapters: Chapter[]
): T[] {
  const set = new Set(chapters.map((c) => `${c.book}:${c.chapter}`));
  return rows.filter((r) => set.has(`${r.book}:${r.chapter}`));
}

// ─── Import helpers ──────────────────────────────────────────────────────────

async function importSectionBreaks(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  // Scene breaks
  const cond = chapterCondition(sceneBreaks, src, chapters);
  if (!cond) return 0;
  let sbRows = await userDb.select().from(sceneBreaks).where(cond);
  sbRows = filterByChapters(sbRows, chapters);

  if (sbRows.length > 0) {
    await userDb
      .insert(sceneBreaks)
      .values(sbRows.map((r) => ({ ...r, id: undefined, workspaceId: tgt })))
      .onConflictDoNothing();
  }

  // Paragraph breaks
  const pbCond = chapterCondition(paragraphBreaks, src, chapters);
  if (pbCond) {
    let pbRows = await userDb.select().from(paragraphBreaks).where(pbCond);
    pbRows = filterByChapters(pbRows, chapters);
    if (pbRows.length > 0) {
      await userDb
        .insert(paragraphBreaks)
        .values(pbRows.map((r) => ({ ...r, id: undefined, workspaceId: tgt })))
        .onConflictDoNothing();
    }
  }

  return sbRows.length;
}

async function importLineAnnotations(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  const cond = chapterCondition(lineAnnotations, src, chapters);
  if (!cond) return 0;
  let rows = await userDb.select().from(lineAnnotations).where(cond);
  rows = filterByChapters(rows, chapters);

  if (rows.length > 0) {
    await userDb
      .insert(lineAnnotations)
      .values(rows.map((r) => ({ ...r, id: undefined, workspaceId: tgt })));
  }
  return rows.length;
}

async function importWordFormatting(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  const cond = chapterCondition(wordFormatting, src, chapters);
  if (!cond) return 0;
  let rows = await userDb.select().from(wordFormatting).where(cond);
  rows = filterByChapters(rows, chapters);

  if (rows.length > 0) {
    await userDb
      .insert(wordFormatting)
      .values(rows.map((r) => ({ ...r, id: undefined, workspaceId: tgt })))
      .onConflictDoNothing();
  }
  return rows.length;
}

async function importLineIndents(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  const cond = chapterCondition(lineIndents, src, chapters);
  if (!cond) return 0;
  let rows = await userDb.select().from(lineIndents).where(cond);
  rows = filterByChapters(rows, chapters);

  if (rows.length > 0) {
    await userDb
      .insert(lineIndents)
      .values(rows.map((r) => ({ ...r, id: undefined, workspaceId: tgt })))
      .onConflictDoNothing();
  }
  return rows.length;
}

async function importWordArrows(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  const cond = chapterCondition(wordArrows, src, chapters);
  if (!cond) return 0;
  let rows = await userDb.select().from(wordArrows).where(cond);
  rows = filterByChapters(rows, chapters);

  if (rows.length > 0) {
    await userDb
      .insert(wordArrows)
      .values(rows.map((r) => ({ ...r, id: undefined, workspaceId: tgt })));
  }
  return rows.length;
}

async function importClauseRelationships(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  const cond = chapterCondition(clauseRelationships, src, chapters);
  if (!cond) return 0;
  let rows = await userDb.select().from(clauseRelationships).where(cond);
  rows = filterByChapters(rows, chapters);

  if (rows.length > 0) {
    await userDb
      .insert(clauseRelationships)
      .values(rows.map((r) => ({ ...r, id: undefined, workspaceId: tgt })));
  }
  return rows.length;
}

async function importNotes(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  // notes.book and notes.chapter are nullable; filter to rows with matching chapter
  const books = [...new Set(chapters.map((c) => c.book))];
  const chapterNums = [...new Set(chapters.map((c) => c.chapter))];

  let rows = await userDb
    .select()
    .from(notes)
    .where(
      and(
        eq(notes.workspaceId, src),
        inArray(notes.book as (typeof notes)["book"], books),
        inArray(notes.chapter as (typeof notes)["chapter"], chapterNums)
      )
    );

  // Post-filter because chapter numbers may overlap across books
  rows = rows.filter((r) => {
    if (r.book == null || r.chapter == null) return false;
    return chapters.some((c) => c.book === r.book && c.chapter === r.chapter);
  });

  if (rows.length > 0) {
    await userDb
      .insert(notes)
      .values(rows.map((r) => ({ ...r, id: undefined, workspaceId: tgt })))
      .onConflictDoNothing();
  }
  return rows.length;
}

async function importPassages(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  const books = [...new Set(chapters.map((c) => c.book))];

  const rows = await userDb
    .select()
    .from(passages)
    .where(
      and(eq(passages.workspaceId, src), inArray(passages.book, books))
    );

  if (rows.length > 0) {
    await userDb
      .insert(passages)
      .values(rows.map((r) => ({ ...r, id: undefined, workspaceId: tgt })));
  }
  return rows.length;
}

async function importWordTags(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  const books = [...new Set(chapters.map((c) => c.book))];

  // 1. Fetch source tags for these books
  const srcTags = await userDb
    .select()
    .from(wordTags)
    .where(and(eq(wordTags.workspaceId, src), inArray(wordTags.book, books)));

  if (srcTags.length === 0) return 0;

  // 2. Build ID map: srcTagId → targetTagId
  const tagIdMap = new Map<number, number>();
  for (const tag of srcTags) {
    // Look for matching tag in target by (name, color, type, book)
    const existing = await userDb
      .select()
      .from(wordTags)
      .where(
        and(
          eq(wordTags.workspaceId, tgt),
          eq(wordTags.name, tag.name),
          eq(wordTags.color, tag.color),
          eq(wordTags.type, tag.type),
          eq(wordTags.book, tag.book)
        )
      );

    if (existing.length > 0) {
      tagIdMap.set(tag.id, existing[0].id);
    } else {
      const inserted = await userDb
        .insert(wordTags)
        .values({ ...tag, id: undefined, workspaceId: tgt })
        .returning({ id: wordTags.id });
      tagIdMap.set(tag.id, inserted[0].id);
    }
  }

  // 3. Fetch wordTagRefs for scoped chapters
  const cond = chapterCondition(wordTagRefs, src, chapters);
  if (!cond) return 0;
  let refs = await userDb.select().from(wordTagRefs).where(cond);
  refs = filterByChapters(refs, chapters);
  // Only copy refs whose tagId is in our map
  refs = refs.filter((r) => tagIdMap.has(r.tagId));

  if (refs.length > 0) {
    await userDb
      .insert(wordTagRefs)
      .values(
        refs.map((r) => ({
          ...r,
          id: undefined,
          workspaceId: tgt,
          tagId: tagIdMap.get(r.tagId)!,
        }))
      )
      .onConflictDoNothing();
  }
  return refs.length;
}

async function importCharacters(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  const books = [...new Set(chapters.map((c) => c.book))];

  // 1. Fetch source characters for these books
  const srcChars = await userDb
    .select()
    .from(characters)
    .where(
      and(eq(characters.workspaceId, src), inArray(characters.book, books))
    );

  if (srcChars.length === 0) return 0;

  // 2. Build ID map: srcCharId → targetCharId
  const charIdMap = new Map<number, number>();
  for (const char of srcChars) {
    const existing = await userDb
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.workspaceId, tgt),
          eq(characters.name, char.name),
          eq(characters.book, char.book)
        )
      );

    if (existing.length > 0) {
      charIdMap.set(char.id, existing[0].id);
    } else {
      const inserted = await userDb
        .insert(characters)
        .values({ ...char, id: undefined, workspaceId: tgt })
        .returning({ id: characters.id });
      charIdMap.set(char.id, inserted[0].id);
    }
  }

  // 3. Fetch and insert characterRefs
  const crCond = chapterCondition(characterRefs, src, chapters);
  let crCount = 0;
  if (crCond) {
    let refs = await userDb.select().from(characterRefs).where(crCond);
    refs = filterByChapters(refs, chapters);
    refs = refs.filter((r) => charIdMap.has(r.character1Id));

    if (refs.length > 0) {
      await userDb
        .insert(characterRefs)
        .values(
          refs.map((r) => ({
            ...r,
            id: undefined,
            workspaceId: tgt,
            character1Id: charIdMap.get(r.character1Id)!,
            character2Id:
              r.character2Id != null ? (charIdMap.get(r.character2Id) ?? null) : null,
          }))
        )
        .onConflictDoNothing();
      crCount = refs.length;
    }
  }

  // 4. Fetch and insert speechSections
  const ssCond = chapterCondition(speechSections, src, chapters);
  let ssCount = 0;
  if (ssCond) {
    let sections = await userDb.select().from(speechSections).where(ssCond);
    sections = filterByChapters(sections, chapters);
    sections = sections.filter((r) => charIdMap.has(r.characterId));

    if (sections.length > 0) {
      await userDb
        .insert(speechSections)
        .values(
          sections.map((r) => ({
            ...r,
            id: undefined,
            workspaceId: tgt,
            characterId: charIdMap.get(r.characterId)!,
          }))
        );
      ssCount = sections.length;
    }
  }

  return crCount + ssCount;
}

async function importTranslationVerses(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  // 1. Find translation verses for scoped chapters in source workspace
  const chapterNums = [...new Set(chapters.map((c) => c.chapter))];
  const srcVerses = await userDb
    .select()
    .from(translationVerses)
    .where(
      and(
        eq(translationVerses.workspaceId, src),
        inArray(translationVerses.chapter, chapterNums)
      )
    );

  if (srcVerses.length === 0) return 0;

  const srcTransIds = [...new Set(srcVerses.map((v) => v.translationId))];

  // 2. Fetch source translation records and build ID map
  const srcTranslations = await userDb
    .select()
    .from(translations)
    .where(
      and(
        eq(translations.workspaceId, src),
        inArray(translations.id, srcTransIds)
      )
    );

  const transIdMap = new Map<number, number>();
  for (const trans of srcTranslations) {
    const existing = await userDb
      .select()
      .from(translations)
      .where(
        and(
          eq(translations.workspaceId, tgt),
          eq(translations.abbreviation, trans.abbreviation)
        )
      );

    if (existing.length > 0) {
      transIdMap.set(trans.id, existing[0].id);
    } else {
      const inserted = await userDb
        .insert(translations)
        .values({ ...trans, id: undefined, workspaceId: tgt })
        .returning({ id: translations.id });
      transIdMap.set(trans.id, inserted[0].id);
    }
  }

  // 3. Insert translationVerses with remapped translationId
  const versesToInsert = srcVerses.filter((v) => transIdMap.has(v.translationId));
  if (versesToInsert.length > 0) {
    await userDb
      .insert(translationVerses)
      .values(
        versesToInsert.map((v) => ({
          ...v,
          id: undefined,
          workspaceId: tgt,
          translationId: transIdMap.get(v.translationId)!,
        }))
      )
      .onConflictDoNothing();
  }
  return versesToInsert.length;
}

async function importRstRelations(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  const cond = chapterCondition(rstRelations, src, chapters);
  if (!cond) return 0;
  let rows = await userDb.select().from(rstRelations).where(cond);
  rows = filterByChapters(rows, chapters);

  if (rows.length > 0) {
    await userDb
      .insert(rstRelations)
      .values(rows.map((r) => ({ ...r, id: undefined, workspaceId: tgt })));
  }

  // Copy any custom types referenced by these relations
  const customRelTypes = [
    ...new Set(rows.map((r) => r.relType).filter((t) => t.startsWith("custom_"))),
  ];
  if (customRelTypes.length > 0) {
    const srcCustomTypes = await userDb
      .select()
      .from(rstCustomTypes)
      .where(
        and(
          eq(rstCustomTypes.workspaceId, src),
          inArray(rstCustomTypes.key, customRelTypes)
        )
      );

    if (srcCustomTypes.length > 0) {
      await userDb
        .insert(rstCustomTypes)
        .values(
          srcCustomTypes.map((r) => ({ ...r, id: undefined, workspaceId: tgt }))
        )
        .onConflictDoNothing();
    }
  }

  return rows.length;
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const targetWorkspaceId = await getActiveWorkspaceId();

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sourceWorkspaceId, scope, dataTypes } = body;

  if (
    typeof sourceWorkspaceId !== "number" ||
    !scope ||
    !Array.isArray(dataTypes)
  ) {
    return NextResponse.json(
      { error: "Missing or invalid required fields" },
      { status: 400 }
    );
  }

  if (sourceWorkspaceId === targetWorkspaceId) {
    return NextResponse.json(
      { error: "Source and target workspace must be different" },
      { status: 400 }
    );
  }

  const chapters = await resolveScope(scope, sourceWorkspaceId);
  if (chapters.length === 0) {
    return NextResponse.json(
      { error: "Scope resolved to no chapters" },
      { status: 400 }
    );
  }

  const results: Record<string, { imported: number }> = {};

  for (const dataType of dataTypes) {
    let count = 0;

    switch (dataType) {
      case "translationVerses":
        count = await importTranslationVerses(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "sectionBreaks":
        count = await importSectionBreaks(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "lineAnnotations":
        count = await importLineAnnotations(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "wordTags":
        count = await importWordTags(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "wordFormatting":
        count = await importWordFormatting(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "characters":
        count = await importCharacters(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "lineIndents":
        count = await importLineIndents(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "wordArrows":
        count = await importWordArrows(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "clauseRelationships":
        count = await importClauseRelationships(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "rstRelations":
        count = await importRstRelations(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "notes":
        count = await importNotes(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "passages":
        count = await importPassages(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
    }

    results[dataType] = { imported: count };
  }

  return NextResponse.json({ ok: true, results });
}
