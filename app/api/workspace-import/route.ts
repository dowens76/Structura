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
  rstRelations,
  rstCustomTypes,
  notes,
  passages,
  constituentLabels,
  transliterationFormats,
  textCriticalMarks,
  paragraphHeadings,
  translationFootnotes,
  translationVersions,
  wordDatasets,
  wordDatasetEntries,
  bookGroupings,
  bookmarks,
  intertextualLinks,
} from "@/lib/db/user-schema";
import { getActiveWorkspaceId } from "@/lib/workspace";
import {
  resolveScope,
  chapterCondition,
  filterByChapters,
  filterVersesByChapters,
  buildVersionMap,
  type Chapter,
  type Scope,
  type DataType,
  type OverwritableDataType,
  type OverwriteMode,
} from "@/lib/workspace-import";

export const dynamic = "force-dynamic";

interface RequestBody {
  sourceWorkspaceId: number;
  scope: Scope;
  dataTypes: DataType[];
  /** Per-data-type resolution when the target workspace already has data in scope
   *  (see /api/workspace-import/check). Defaults to "add" (insert alongside
   *  existing data) when not specified — matches pre-existing behavior. */
  overwrite?: Partial<Record<OverwritableDataType, OverwriteMode>>;
}

// ─── Import helpers ──────────────────────────────────────────────────────────

async function importSectionBreaks(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  const cond = chapterCondition(sceneBreaks, src, chapters);
  if (!cond) return 0;
  let sbRows = await userDb.select().from(sceneBreaks).where(cond);
  sbRows = filterByChapters(sbRows, chapters);

  const srcVersions = await buildVersionMap(src, chapters);
  sbRows = sbRows.filter((r) => r.versionId === srcVersions.get(`${r.book}:${r.chapter}`));

  if (sbRows.length > 0) {
    const tgtVersions = await buildVersionMap(tgt, chapters);
    await userDb
      .insert(sceneBreaks)
      .values(sbRows.map((r) => ({ ...r, id: undefined, workspaceId: tgt, versionId: tgtVersions.get(`${r.book}:${r.chapter}`)! })))
      .onConflictDoNothing();
  }

  return sbRows.length;
}

async function importParagraphBreaks(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  const cond = chapterCondition(paragraphBreaks, src, chapters);
  if (!cond) return 0;
  let rows = await userDb.select().from(paragraphBreaks).where(cond);
  rows = filterByChapters(rows, chapters);

  const srcVersions = await buildVersionMap(src, chapters);
  rows = rows.filter((r) => r.versionId === srcVersions.get(`${r.book}:${r.chapter}`));

  if (rows.length > 0) {
    const tgtVersions = await buildVersionMap(tgt, chapters);
    await userDb
      .insert(paragraphBreaks)
      .values(rows.map((r) => ({ ...r, id: undefined, workspaceId: tgt, versionId: tgtVersions.get(`${r.book}:${r.chapter}`)! })))
      .onConflictDoNothing();
  }

  return rows.length;
}

async function importLineAnnotations(
  src: number,
  tgt: number,
  chapters: Chapter[],
  mode: OverwriteMode
): Promise<number> {
  if (chapters.length === 0 || mode === "skip") return 0;

  const cond = chapterCondition(lineAnnotations, src, chapters);
  if (!cond) return 0;
  let rows = await userDb.select().from(lineAnnotations).where(cond);
  rows = filterByChapters(rows, chapters);

  const srcVersions = await buildVersionMap(src, chapters);
  rows = rows.filter((r) => r.versionId === srcVersions.get(`${r.book}:${r.chapter}`));

  const tgtVersions = await buildVersionMap(tgt, chapters);

  if (mode === "overwrite") {
    const tgtCond = chapterCondition(lineAnnotations, tgt, chapters);
    if (tgtCond) {
      let tgtRows = await userDb.select({ id: lineAnnotations.id, book: lineAnnotations.book, chapter: lineAnnotations.chapter, versionId: lineAnnotations.versionId }).from(lineAnnotations).where(tgtCond);
      tgtRows = filterByChapters(tgtRows, chapters);
      const idsInActiveVersion = tgtRows
        .filter((r) => r.versionId === tgtVersions.get(`${r.book}:${r.chapter}`))
        .map((r) => r.id);
      if (idsInActiveVersion.length > 0) {
        await userDb.delete(lineAnnotations).where(inArray(lineAnnotations.id, idsInActiveVersion));
      }
    }
  }

  if (rows.length > 0) {
    await userDb
      .insert(lineAnnotations)
      .values(rows.map((r) => ({ ...r, id: undefined, workspaceId: tgt, versionId: tgtVersions.get(`${r.book}:${r.chapter}`)! })));
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

  const srcVersions = await buildVersionMap(src, chapters);
  rows = rows.filter((r) => r.versionId === srcVersions.get(`${r.book}:${r.chapter}`));

  if (rows.length > 0) {
    const tgtVersions = await buildVersionMap(tgt, chapters);
    await userDb
      .insert(wordFormatting)
      .values(rows.map((r) => ({ ...r, id: undefined, workspaceId: tgt, versionId: tgtVersions.get(`${r.book}:${r.chapter}`)! })))
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

  const srcVersions = await buildVersionMap(src, chapters);
  rows = rows.filter((r) => r.versionId === srcVersions.get(`${r.book}:${r.chapter}`));

  if (rows.length > 0) {
    const tgtVersions = await buildVersionMap(tgt, chapters);
    await userDb
      .insert(lineIndents)
      .values(rows.map((r) => ({ ...r, id: undefined, workspaceId: tgt, versionId: tgtVersions.get(`${r.book}:${r.chapter}`)! })))
      .onConflictDoNothing();
  }
  return rows.length;
}

async function importConstituentLabels(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  const cond = chapterCondition(constituentLabels, src, chapters);
  if (!cond) return 0;
  let rows = await userDb.select().from(constituentLabels).where(cond);
  rows = filterByChapters(rows, chapters);

  if (rows.length > 0) {
    await userDb
      .insert(constituentLabels)
      .values(rows.map((r) => ({ ...r, id: undefined, workspaceId: tgt })))
      .onConflictDoNothing();
  }
  return rows.length;
}

async function importTransliterationFormats(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  const cond = chapterCondition(transliterationFormats, src, chapters);
  if (!cond) return 0;
  let rows = await userDb.select().from(transliterationFormats).where(cond);
  rows = filterByChapters(rows, chapters);

  if (rows.length > 0) {
    await userDb
      .insert(transliterationFormats)
      .values(rows.map((r) => ({ ...r, id: undefined, workspaceId: tgt })))
      .onConflictDoNothing();
  }
  return rows.length;
}

async function importTextCriticalMarks(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  const cond = chapterCondition(textCriticalMarks, src, chapters);
  if (!cond) return 0;
  let rows = await userDb.select().from(textCriticalMarks).where(cond);
  rows = filterByChapters(rows, chapters);

  const srcVersions = await buildVersionMap(src, chapters);
  rows = rows.filter((r) => r.versionId === srcVersions.get(`${r.book}:${r.chapter}`));

  if (rows.length > 0) {
    const tgtVersions = await buildVersionMap(tgt, chapters);
    await userDb
      .insert(textCriticalMarks)
      .values(rows.map((r) => ({ ...r, id: undefined, workspaceId: tgt, versionId: tgtVersions.get(`${r.book}:${r.chapter}`)! })))
      .onConflictDoNothing();
  }
  return rows.length;
}

async function importParagraphHeadings(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  const cond = chapterCondition(paragraphHeadings, src, chapters);
  if (!cond) return 0;
  let rows = await userDb.select().from(paragraphHeadings).where(cond);
  rows = filterByChapters(rows, chapters);

  if (rows.length > 0) {
    await userDb
      .insert(paragraphHeadings)
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

  const srcVersions = await buildVersionMap(src, chapters);
  rows = rows.filter((r) => r.versionId === srcVersions.get(`${r.book}:${r.chapter}`));

  if (rows.length > 0) {
    const tgtVersions = await buildVersionMap(tgt, chapters);
    await userDb
      .insert(wordArrows)
      .values(rows.map((r) => ({ ...r, id: undefined, workspaceId: tgt, versionId: tgtVersions.get(`${r.book}:${r.chapter}`)! })));
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

  const srcVersions = await buildVersionMap(src, chapters);
  refs = refs.filter((r) => r.versionId === srcVersions.get(`${r.book}:${r.chapter}`));

  if (refs.length > 0) {
    const tgtVersions = await buildVersionMap(tgt, chapters);
    await userDb
      .insert(wordTagRefs)
      .values(
        refs.map((r) => ({
          ...r,
          id: undefined,
          workspaceId: tgt,
          versionId: tgtVersions.get(`${r.book}:${r.chapter}`)!,
          tagId: tagIdMap.get(r.tagId)!,
        }))
      )
      .onConflictDoNothing();
  }
  return refs.length;
}

async function importWordDatasets(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  // wordDatasetEntries has no workspaceId of its own (only datasetId), so we
  // have to go entries-first: find the source workspace's datasets, fetch
  // their entries, filter by scope, and only then figure out which datasets
  // are actually referenced in scope.
  const srcDatasets = await userDb
    .select()
    .from(wordDatasets)
    .where(eq(wordDatasets.workspaceId, src));
  if (srcDatasets.length === 0) return 0;

  const srcDatasetIds = srcDatasets.map((d) => d.id);
  let entries = await userDb
    .select()
    .from(wordDatasetEntries)
    .where(inArray(wordDatasetEntries.datasetId, srcDatasetIds));
  entries = filterByChapters(entries, chapters);

  if (entries.length === 0) return 0;

  // Match-or-create each referenced dataset in the target workspace by name.
  const referencedDatasetIds = [...new Set(entries.map((e) => e.datasetId))];
  const datasetIdMap = new Map<number, number>();
  for (const datasetId of referencedDatasetIds) {
    const dataset = srcDatasets.find((d) => d.id === datasetId)!;
    const existing = await userDb
      .select()
      .from(wordDatasets)
      .where(and(eq(wordDatasets.workspaceId, tgt), eq(wordDatasets.name, dataset.name)));

    if (existing.length > 0) {
      datasetIdMap.set(dataset.id, existing[0].id);
    } else {
      const inserted = await userDb
        .insert(wordDatasets)
        .values({ ...dataset, id: undefined, workspaceId: tgt })
        .returning({ id: wordDatasets.id });
      datasetIdMap.set(dataset.id, inserted[0].id);
    }
  }

  await userDb
    .insert(wordDatasetEntries)
    .values(
      entries.map((e) => ({
        ...e,
        id: undefined,
        datasetId: datasetIdMap.get(e.datasetId)!,
      }))
    )
    .onConflictDoNothing();

  return entries.length;
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

  const srcVersions = await buildVersionMap(src, chapters);
  const tgtVersions = await buildVersionMap(tgt, chapters);

  // 3. Fetch and insert characterRefs
  const crCond = chapterCondition(characterRefs, src, chapters);
  let crCount = 0;
  if (crCond) {
    let refs = await userDb.select().from(characterRefs).where(crCond);
    refs = filterByChapters(refs, chapters);
    refs = refs.filter((r) => charIdMap.has(r.character1Id));
    refs = refs.filter((r) => r.versionId === srcVersions.get(`${r.book}:${r.chapter}`));

    if (refs.length > 0) {
      await userDb
        .insert(characterRefs)
        .values(
          refs.map((r) => ({
            ...r,
            id: undefined,
            workspaceId: tgt,
            versionId: tgtVersions.get(`${r.book}:${r.chapter}`)!,
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
    sections = sections.filter((r) => r.versionId === srcVersions.get(`${r.book}:${r.chapter}`));

    if (sections.length > 0) {
      await userDb
        .insert(speechSections)
        .values(
          sections.map((r) => ({
            ...r,
            id: undefined,
            workspaceId: tgt,
            versionId: tgtVersions.get(`${r.book}:${r.chapter}`)!,
            characterId: charIdMap.get(r.characterId)!,
          }))
        );
      ssCount = sections.length;
    }
  }

  return crCount + ssCount;
}

/**
 * Resolves the target-workspace translation id for each source translation
 * referenced by `srcTransIds`, creating a target translation row when no
 * translation with the same abbreviation exists yet.
 *
 * Translations are shared across workspaces (see getTranslations in
 * lib/db/queries.ts — abbreviation is globally unique), so this must match
 * purely by abbreviation, never by workspaceId.
 */
async function resolveTranslationIdMap(
  srcTransIds: number[],
  tgt: number
): Promise<Map<number, number>> {
  const srcTranslations = await userDb
    .select()
    .from(translations)
    .where(inArray(translations.id, srcTransIds));

  const transIdMap = new Map<number, number>();
  for (const trans of srcTranslations) {
    const existing = await userDb
      .select()
      .from(translations)
      .where(eq(translations.abbreviation, trans.abbreviation));

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
  return transIdMap;
}

async function importTranslationVerses(
  src: number,
  tgt: number,
  chapters: Chapter[],
  mode: OverwriteMode
): Promise<number> {
  if (chapters.length === 0 || mode === "skip") return 0;

  // 1. Find translation verses for scoped chapters in source workspace.
  // Chapter-number-only filtering would also pull in unrelated books that
  // happen to share a chapter number, so narrow further by osisRef prefix.
  const chapterNums = [...new Set(chapters.map((c) => c.chapter))];
  let srcVerses = await userDb
    .select()
    .from(translationVerses)
    .where(
      and(
        eq(translationVerses.workspaceId, src),
        inArray(translationVerses.chapter, chapterNums)
      )
    );
  srcVerses = filterVersesByChapters(srcVerses, chapters);

  if (srcVerses.length === 0) return 0;

  const srcTransIds = [...new Set(srcVerses.map((v) => v.translationId))];
  const transIdMap = await resolveTranslationIdMap(srcTransIds, tgt);

  if (mode === "overwrite") {
    const tgtTransIds = [...transIdMap.values()];
    if (tgtTransIds.length > 0) {
      let existingTgtVerses = await userDb
        .select({ id: translationVerses.id, osisRef: translationVerses.osisRef })
        .from(translationVerses)
        .where(
          and(
            eq(translationVerses.workspaceId, tgt),
            inArray(translationVerses.translationId, tgtTransIds),
            inArray(translationVerses.chapter, chapterNums)
          )
        );
      existingTgtVerses = filterVersesByChapters(existingTgtVerses, chapters);
      const idsToDelete = existingTgtVerses.map((v) => v.id);
      if (idsToDelete.length > 0) {
        await userDb
          .delete(translationVerses)
          .where(inArray(translationVerses.id, idsToDelete));
      }
    }
  }

  // 2. Insert translationVerses with remapped translationId
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
      );
  }
  return versesToInsert.length;
}

async function importTranslationFootnotes(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  const cond = chapterCondition(translationFootnotes, src, chapters);
  if (!cond) return 0;
  let rows = await userDb.select().from(translationFootnotes).where(cond);
  rows = filterByChapters(rows, chapters);

  if (rows.length === 0) return 0;

  const srcTransIds = [...new Set(rows.map((r) => r.translationId))];
  const transIdMap = await resolveTranslationIdMap(srcTransIds, tgt);

  const rowsToInsert = rows.filter((r) => transIdMap.has(r.translationId));
  if (rowsToInsert.length > 0) {
    await userDb
      .insert(translationFootnotes)
      .values(
        rowsToInsert.map((r) => ({
          ...r,
          id: undefined,
          workspaceId: tgt,
          translationId: transIdMap.get(r.translationId)!,
        }))
      );
  }
  return rowsToInsert.length;
}

async function importTranslationVersions(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  // No book/chapter columns — only osisRef — so scope by prefix like translationVerses.
  let rows = await userDb
    .select()
    .from(translationVersions)
    .where(eq(translationVersions.workspaceId, src));
  rows = filterVersesByChapters(rows, chapters);

  if (rows.length === 0) return 0;

  const srcTransIds = [...new Set(rows.map((r) => r.translationId))];
  const transIdMap = await resolveTranslationIdMap(srcTransIds, tgt);

  const rowsToInsert = rows.filter((r) => transIdMap.has(r.translationId));
  if (rowsToInsert.length > 0) {
    await userDb
      .insert(translationVersions)
      .values(
        rowsToInsert.map((r) => ({
          ...r,
          id: undefined,
          workspaceId: tgt,
          translationId: transIdMap.get(r.translationId)!,
        }))
      );
  }
  return rowsToInsert.length;
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

  const srcVersions = await buildVersionMap(src, chapters);
  rows = rows.filter((r) => r.versionId === srcVersions.get(`${r.book}:${r.chapter}`));

  if (rows.length > 0) {
    const tgtVersions = await buildVersionMap(tgt, chapters);
    await userDb
      .insert(rstRelations)
      .values(rows.map((r) => ({ ...r, id: undefined, workspaceId: tgt, versionId: tgtVersions.get(`${r.book}:${r.chapter}`)! })));
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

// ─── Group D: bespoke scope logic ────────────────────────────────────────────
// These tables don't fit the book+chapter scope model used above, so each
// gets its own matching rule instead of chapterCondition/filterByChapters.

async function importBookGroupings(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  const scopeBooks = new Set(chapters.map((c) => c.book));

  const srcGroupings = await userDb
    .select()
    .from(bookGroupings)
    .where(eq(bookGroupings.workspaceId, src));

  const inScope = srcGroupings.filter((g) => {
    let books: string[];
    try {
      books = JSON.parse(g.books);
    } catch {
      return false;
    }
    return books.some((b) => scopeBooks.has(b));
  });

  if (inScope.length === 0) return 0;

  // Match-or-skip by name — groupings are workspace-level metadata, not
  // per-word annotations, so re-creating a duplicate "Pentateuch" on repeat
  // imports would be confusing rather than additive.
  //
  // Known limitation: wordTags.corpusGroupingId (a plain int FK to this
  // table) isn't remapped by importWordTags, here or previously — a copied
  // word tag that references a grouping keeps the *source* workspace's
  // grouping id, which may not correspond to anything in the target. Fixing
  // that would require importWordTags to depend on this function's id map,
  // which is out of scope unless requested separately.
  for (const grouping of inScope) {
    const existing = await userDb
      .select({ id: bookGroupings.id })
      .from(bookGroupings)
      .where(and(eq(bookGroupings.workspaceId, tgt), eq(bookGroupings.name, grouping.name)));

    if (existing.length === 0) {
      await userDb
        .insert(bookGroupings)
        .values({ ...grouping, id: undefined, workspaceId: tgt });
    }
  }

  return inScope.length;
}

/**
 * Bookmark hrefs are always "/{book}/{source}/{chapter}" (optionally with a
 * "?par=1" query string) or "/{book}/{source}/passage/{passageId}" — see
 * BookmarkButton.tsx. Returns null chapter for the passage shape, since a
 * passage id isn't portable across workspaces.
 */
function parseBookmarkHref(href: string): { book: string; chapter: number | null } | null {
  const parts = href.split("?")[0].split("/");
  if (parts.length < 4 || !parts[1]) return null;
  const book = decodeURIComponent(parts[1]);
  if (parts[3] === "passage") return { book, chapter: null };
  const chapter = parseInt(parts[3], 10);
  if (isNaN(chapter)) return null;
  return { book, chapter };
}

async function importBookmarks(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  const scopeBooks = new Set(chapters.map((c) => c.book));
  const chapterSet = new Set(chapters.map((c) => `${c.book}:${c.chapter}`));

  const srcBookmarks = await userDb
    .select()
    .from(bookmarks)
    .where(eq(bookmarks.workspaceId, src));

  const inScope = srcBookmarks.filter((b) => {
    const parsed = parseBookmarkHref(b.href);
    if (!parsed || !scopeBooks.has(parsed.book)) return false;
    // Chapter-shaped hrefs must match the specific chapter; passage-shaped
    // hrefs (chapter === null) match on book alone as the practical fallback.
    if (parsed.chapter === null) return true;
    return chapterSet.has(`${parsed.book}:${parsed.chapter}`);
  });

  if (inScope.length === 0) return 0;

  await userDb.insert(bookmarks).values(
    inScope.map((b, i) => ({
      ...b,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}-${i}`,
      workspaceId: tgt,
    }))
  );
  return inScope.length;
}

async function importIntertextualLinks(
  src: number,
  tgt: number,
  chapters: Chapter[]
): Promise<number> {
  if (chapters.length === 0) return 0;

  const chapterSet = new Set(chapters.map((c) => `${c.book}:${c.chapter}`));

  const srcLinks = await userDb
    .select()
    .from(intertextualLinks)
    .where(eq(intertextualLinks.workspaceId, src));

  // Match if either side of the link falls within scope — copying a
  // chapter's data should bring along links that touch it from either
  // direction.
  const inScope = srcLinks.filter(
    (l) =>
      chapterSet.has(`${l.sourceBook}:${l.sourceChapter}`) ||
      chapterSet.has(`${l.targetBook}:${l.targetChapter}`)
  );

  if (inScope.length > 0) {
    await userDb
      .insert(intertextualLinks)
      .values(inScope.map((r) => ({ ...r, id: undefined, workspaceId: tgt })));
  }
  return inScope.length;
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

  const { sourceWorkspaceId, scope, dataTypes, overwrite } = body;

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
          chapters,
          overwrite?.translationVerses ?? "add"
        );
        break;
      case "sectionBreaks":
        count = await importSectionBreaks(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "paragraphBreaks":
        count = await importParagraphBreaks(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "lineAnnotations":
        count = await importLineAnnotations(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters,
          overwrite?.lineAnnotations ?? "add"
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
      case "constituentLabels":
        count = await importConstituentLabels(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "transliterationFormats":
        count = await importTransliterationFormats(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "textCriticalMarks":
        count = await importTextCriticalMarks(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "paragraphHeadings":
        count = await importParagraphHeadings(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "translationFootnotes":
        count = await importTranslationFootnotes(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "translationVersions":
        count = await importTranslationVersions(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "wordDatasets":
        count = await importWordDatasets(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "bookGroupings":
        count = await importBookGroupings(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "bookmarks":
        count = await importBookmarks(
          sourceWorkspaceId,
          targetWorkspaceId,
          chapters
        );
        break;
      case "intertextualLinks":
        count = await importIntertextualLinks(
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
