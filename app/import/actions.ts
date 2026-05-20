"use server";

import { parseBibleComText } from "@/lib/utils/translation-parser";
import { parseUsfmFile } from "@/lib/utils/usfm-full-parser";
import { upsertTranslation, getBook } from "@/lib/db/queries";
import { userDb } from "@/lib/db";
import { translations, translationVerses, translationFootnotes, paragraphBreaks, lineIndents, sceneBreaks } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { formatOsisRef } from "@/lib/utils/osis";

export interface ImportState {
  success: boolean;
  error: string | null;
  count: number;
  redirectTo: string | null;
}

export async function importTranslationAction(
  _prev: ImportState,
  formData: FormData
): Promise<ImportState> {
  const name = (formData.get("name") as string)?.trim();
  const abbreviation = (formData.get("abbreviation") as string)?.trim().toUpperCase();
  const osisBook = (formData.get("osisBook") as string)?.trim();
  const chapterStr = formData.get("chapter") as string;
  const pastedText = (formData.get("pastedText") as string)?.trim();

  if (!name || !abbreviation || !osisBook || !chapterStr || !pastedText) {
    return { success: false, error: "All fields are required.", count: 0, redirectTo: null };
  }

  const chapter = parseInt(chapterStr, 10);
  if (isNaN(chapter) || chapter < 1) {
    return { success: false, error: "Invalid chapter number.", count: 0, redirectTo: null };
  }

  const book = await getBook(osisBook);
  if (!book) {
    return {
      success: false,
      error: `Book "${osisBook}" not found. Make sure the source text has been imported.`,
      count: 0,
      redirectTo: null,
    };
  }

  if (chapter > book.chapterCount) {
    return {
      success: false,
      error: `${book.name} only has ${book.chapterCount} chapters.`,
      count: 0,
      redirectTo: null,
    };
  }

  const { verses, detectedChapter } = parseBibleComText(pastedText);

  if (verses.length === 0) {
    return {
      success: false,
      error:
        "No verses could be detected. Make sure the text contains verse numbers (e.g. \"1 In the beginning...\").",
      count: 0,
      redirectTo: null,
    };
  }

  if (detectedChapter !== null && detectedChapter !== chapter) {
    return {
      success: false,
      error: `The pasted text header says chapter ${detectedChapter}, but the form specifies chapter ${chapter}. Please correct and retry.`,
      count: 0,
      redirectTo: null,
    };
  }

  // Translations are workspace-independent — always stored under workspaceId 1.
  const translationId = await upsertTranslation(name, abbreviation);

  // Delete existing verses for this translation+chapter (clean re-import, no workspace filter).
  await userDb
    .delete(translationVerses)
    .where(
      and(
        eq(translationVerses.translationId, translationId),
        eq(translationVerses.bookId, book.id),
        eq(translationVerses.chapter, chapter)
      )
    );

  const rows = verses.map((v) => ({
    workspaceId: 1,
    translationId,
    osisRef: formatOsisRef(osisBook, chapter, v.verse),
    bookId: book.id,
    chapter,
    verse: v.verse,
    text: v.text,
  }));

  await userDb.insert(translationVerses).values(rows);

  return {
    success: true,
    error: null,
    count: verses.length,
    redirectTo: `/${encodeURIComponent(osisBook)}/${book.textSource}/${chapter}`,
  };
}

// ── Full USFM file import ────────────────────────────────────────────────────

export interface ImportUsfmState {
  success: boolean;
  error: string | null;
  count: number;
  detectedBook: string | null;
  booksImported: string[];
  redirectTo: string | null;
}

/**
 * Import a single parsed USFM file into the database.
 * @param chaptersToProcess - null means import all chapters (overwrite);
 *   a Set means import only those chapter numbers (skipping others that exist).
 */
async function importSingleUsfmFile(
  parsed: Awaited<ReturnType<typeof parseUsfmFile>>,
  translationId: number,
  abbreviation: string,
  chaptersToProcess: Set<number> | null,
): Promise<{ count: number; error?: string }> {
  if (!parsed.detectedBook) return { count: 0, error: "No \\id marker detected." };
  if (parsed.verses.length === 0) return { count: 0, error: "No verses found." };

  const book = await getBook(parsed.detectedBook);
  if (!book) return { count: 0, error: `Book "${parsed.detectedBook}" not found in source database.` };

  const BATCH = 500;
  const osisBook = parsed.detectedBook;
  const textSource = book.textSource;
  const tvPrefix = `tv:${abbreviation}:${osisBook}.`;

  const shouldProcess = (ch: number) => chaptersToProcess === null || chaptersToProcess.has(ch);

  // ── Delete existing data for the chapters we're about to (re)import ──────────
  if (chaptersToProcess === null) {
    // Overwrite all: wholesale book-level delete
    await userDb.delete(translationVerses).where(
      and(eq(translationVerses.translationId, translationId), eq(translationVerses.bookId, book.id))
    );
    await userDb.delete(translationFootnotes).where(
      and(eq(translationFootnotes.translationId, translationId), eq(translationFootnotes.book, osisBook))
    );

    const allParaBreaks = await userDb
      .select({ id: paragraphBreaks.id, wordId: paragraphBreaks.wordId })
      .from(paragraphBreaks).where(eq(paragraphBreaks.book, osisBook));
    const pbIds = allParaBreaks.filter(pb => pb.wordId.startsWith(tvPrefix)).map(pb => pb.id);
    if (pbIds.length > 0) await userDb.delete(paragraphBreaks).where(inArray(paragraphBreaks.id, pbIds));

    const allLineIndentsRows = await userDb
      .select({ id: lineIndents.id, wordId: lineIndents.wordId })
      .from(lineIndents).where(eq(lineIndents.book, osisBook));
    const liIds = allLineIndentsRows.filter(li => li.wordId.startsWith(tvPrefix)).map(li => li.id);
    if (liIds.length > 0) await userDb.delete(lineIndents).where(inArray(lineIndents.id, liIds));

    const allSceneBreaks = await userDb
      .select({ id: sceneBreaks.id, wordId: sceneBreaks.wordId })
      .from(sceneBreaks).where(eq(sceneBreaks.book, osisBook));
    const sbIds = allSceneBreaks.filter(sb => sb.wordId.startsWith(tvPrefix)).map(sb => sb.id);
    if (sbIds.length > 0) await userDb.delete(sceneBreaks).where(inArray(sceneBreaks.id, sbIds));
  } else {
    // Selective: delete only the chapters we're overwriting
    const chapterList = [...chaptersToProcess];
    if (chapterList.length > 0) {
      await userDb.delete(translationVerses).where(
        and(eq(translationVerses.translationId, translationId), eq(translationVerses.bookId, book.id),
          inArray(translationVerses.chapter, chapterList))
      );
      await userDb.delete(translationFootnotes).where(
        and(eq(translationFootnotes.translationId, translationId), eq(translationFootnotes.book, osisBook),
          inArray(translationFootnotes.chapter, chapterList))
      );

      const chParaBreaks = await userDb
        .select({ id: paragraphBreaks.id, wordId: paragraphBreaks.wordId })
        .from(paragraphBreaks)
        .where(and(eq(paragraphBreaks.book, osisBook), inArray(paragraphBreaks.chapter, chapterList)));
      const pbIds = chParaBreaks.filter(pb => pb.wordId.startsWith(tvPrefix)).map(pb => pb.id);
      if (pbIds.length > 0) await userDb.delete(paragraphBreaks).where(inArray(paragraphBreaks.id, pbIds));

      const chLineIndents = await userDb
        .select({ id: lineIndents.id, wordId: lineIndents.wordId })
        .from(lineIndents)
        .where(and(eq(lineIndents.book, osisBook), inArray(lineIndents.chapter, chapterList)));
      const liIds = chLineIndents.filter(li => li.wordId.startsWith(tvPrefix)).map(li => li.id);
      if (liIds.length > 0) await userDb.delete(lineIndents).where(inArray(lineIndents.id, liIds));

      const chSceneBreaks = await userDb
        .select({ id: sceneBreaks.id, wordId: sceneBreaks.wordId })
        .from(sceneBreaks)
        .where(and(eq(sceneBreaks.book, osisBook), inArray(sceneBreaks.chapter, chapterList)));
      const sbIds = chSceneBreaks.filter(sb => sb.wordId.startsWith(tvPrefix)).map(sb => sb.id);
      if (sbIds.length > 0) await userDb.delete(sceneBreaks).where(inArray(sceneBreaks.id, sbIds));
    }
  }

  // ── Insert verses ────────────────────────────────────────────────────────────
  const verseRows = parsed.verses
    .filter(v => shouldProcess(v.chapter))
    .map((v) => ({
      workspaceId: 1, translationId, osisRef: v.osisRef,
      bookId: book.id, chapter: v.chapter, verse: v.verse, text: v.text,
    }));
  for (let i = 0; i < verseRows.length; i += BATCH) {
    await userDb.insert(translationVerses).values(verseRows.slice(i, i + BATCH));
  }

  // ── Insert footnotes ─────────────────────────────────────────────────────────
  const fnRows = parsed.footnotes
    .filter(fn => shouldProcess(fn.chapter))
    .map((fn) => ({
      workspaceId: 1, translationId, osisRef: fn.osisRef,
      type: fn.type, content: fn.content, wordIndex: fn.wordIndex,
      book: fn.book, chapter: fn.chapter, verse: fn.verse,
    }));
  if (fnRows.length > 0) {
    for (let i = 0; i < fnRows.length; i += BATCH) {
      await userDb.insert(translationFootnotes).values(fnRows.slice(i, i + BATCH));
    }
  }

  // ── Insert paragraph breaks ──────────────────────────────────────────────────
  const pbFiltered = parsed.paragraphBreaks.filter(pb => {
    const ch = parseInt(pb.osisRef.split(".")[1] ?? "0", 10);
    return shouldProcess(ch);
  });
  if (pbFiltered.length > 0) {
    const pbRows = pbFiltered.map((pb) => {
      const ch = parseInt(pb.osisRef.split(".")[1] ?? "0", 10);
      return { workspaceId: 1, wordId: `tv:${abbreviation}:${pb.osisRef}`, textSource, book: osisBook, chapter: ch };
    });
    for (let i = 0; i < pbRows.length; i += BATCH) {
      await userDb.insert(paragraphBreaks).values(pbRows.slice(i, i + BATCH)).onConflictDoNothing();
    }
  }

  // ── Insert line indents ──────────────────────────────────────────────────────
  const liFiltered = parsed.lineIndents.filter(li => {
    const ch = parseInt(li.osisRef.split(".")[1] ?? "0", 10);
    return shouldProcess(ch);
  });
  if (liFiltered.length > 0) {
    const liRows = liFiltered.map((li) => {
      const ch = parseInt(li.osisRef.split(".")[1] ?? "0", 10);
      return { workspaceId: 1, wordId: `tv:${abbreviation}:${li.osisRef}`, indentLevel: li.level, textSource, book: osisBook, chapter: ch };
    });
    for (let i = 0; i < liRows.length; i += BATCH) {
      await userDb.insert(lineIndents).values(liRows.slice(i, i + BATCH)).onConflictDoNothing();
    }
  }

  // ── Insert section breaks ────────────────────────────────────────────────────
  const sbFiltered = parsed.sectionBreaks.filter(sb => {
    const ch = parseInt(sb.osisRef.split(".")[1] ?? "0", 10);
    return shouldProcess(ch);
  });
  if (sbFiltered.length > 0) {
    const sbRows = sbFiltered.map((sb) => {
      const parts = sb.osisRef.split(".");
      const ch = parseInt(parts[1] ?? "0", 10);
      const v = parseInt(parts[2] ?? "1", 10);
      return {
        workspaceId: 1, wordId: `tv:${abbreviation}:${sb.osisRef}`, heading: sb.heading,
        level: sb.level, verse: v, outOfSequence: false,
        extendedThrough: null, thematic: false, thematicLetter: null,
        textSource, book: osisBook, chapter: ch,
      };
    });
    for (let i = 0; i < sbRows.length; i += BATCH) {
      await userDb.insert(sceneBreaks).values(sbRows.slice(i, i + BATCH)).onConflictDoNothing();
    }
  }

  return { count: verseRows.length };
}

const USFM_EXTENSIONS = new Set([".usfm", ".sfm", ".SFM", ".USFM"]);

export async function importUsfmFileAction(
  _prev: ImportUsfmState,
  formData: FormData
): Promise<ImportUsfmState> {
  const name         = (formData.get("name") as string)?.trim();
  const abbreviation = (formData.get("abbreviation") as string)?.trim().toUpperCase();
  const files        = formData.getAll("usfmFile") as File[];
  const validFiles   = files.filter(f => f.size > 0 && (
    USFM_EXTENSIONS.has("." + f.name.split(".").pop()) || f.type === "text/plain"
  ));

  // Optional: JSON map of { [osisBook]: number[] } — chapters to process per book.
  // Absent or null entry = process all chapters (overwrite mode).
  const chaptersJson = formData.get("chaptersToProcess") as string | null;
  const chaptersMap: Record<string, number[]> | null = chaptersJson ? JSON.parse(chaptersJson) : null;

  if (!name || !abbreviation) {
    return { success: false, error: "Translation name and abbreviation are required.", count: 0, detectedBook: null, booksImported: [], redirectTo: null };
  }
  if (validFiles.length === 0) {
    return { success: false, error: "No USFM file provided.", count: 0, detectedBook: null, booksImported: [], redirectTo: null };
  }

  const translationId = await upsertTranslation(name, abbreviation);

  let totalCount = 0;
  const booksImported: string[] = [];
  const errors: string[] = [];
  let firstBook: string | null = null;
  let firstTextSource: string | null = null;

  for (const file of validFiles) {
    const usfmContent = await file.text();
    let parsed: Awaited<ReturnType<typeof parseUsfmFile>>;
    try {
      parsed = parseUsfmFile(usfmContent);
    } catch (e) {
      errors.push(`${file.name}: parse error — ${String(e)}`);
      continue;
    }

    if (!parsed.detectedBook) {
      errors.push(`${file.name}: no \\id marker detected`);
      continue;
    }

    const bookChapters = chaptersMap?.[parsed.detectedBook];
    const chaptersToProcess = bookChapters ? new Set(bookChapters) : null;

    const result = await importSingleUsfmFile(parsed, translationId, abbreviation, chaptersToProcess);
    if (result.error) {
      errors.push(`${file.name}: ${result.error}`);
    } else {
      totalCount += result.count;
      booksImported.push(parsed.detectedBook);
      if (!firstBook) {
        firstBook = parsed.detectedBook;
        const bookRecord = await getBook(parsed.detectedBook);
        firstTextSource = bookRecord?.textSource ?? null;
      }
    }
  }

  if (totalCount === 0 && errors.length > 0) {
    return { success: false, error: errors.join("; "), count: 0, detectedBook: null, booksImported: [], redirectTo: null };
  }

  const redirectTo = firstBook && firstTextSource
    ? `/${encodeURIComponent(firstBook)}/${firstTextSource}/1`
    : null;

  return {
    success: true,
    error: errors.length > 0 ? `Imported with warnings: ${errors.join("; ")}` : null,
    count: totalCount,
    detectedBook: firstBook,
    booksImported,
    redirectTo,
  };
}

/** Returns how many verses already exist for a given translation + book + chapter. */
export async function checkExistingVersesAction(
  abbreviation: string,
  osisBook: string,
  chapter: number
): Promise<{ count: number }> {
  if (!abbreviation || !osisBook || !chapter) return { count: 0 };

  const trans = await userDb
    .select({ id: translations.id })
    .from(translations)
    .where(eq(translations.abbreviation, abbreviation.toUpperCase()))
    .limit(1);

  if (!trans[0]) return { count: 0 };

  const book = await getBook(osisBook);
  if (!book) return { count: 0 };

  const rows = await userDb
    .select({ id: translationVerses.id })
    .from(translationVerses)
    .where(
      and(
        eq(translationVerses.translationId, trans[0].id),
        eq(translationVerses.bookId, book.id),
        eq(translationVerses.chapter, chapter)
      )
    );

  return { count: rows.length };
}

// ── Conflict detection for USFM imports ─────────────────────────────────────

export interface BookConflict {
  osisBook: string;
  /** Chapters present in the file that already have translation data in the DB. */
  conflictingChapters: number[];
  /** All chapters present in the incoming file. */
  incomingChapters: number[];
  /** Total chapters in this book (from source DB). */
  totalBookChapters: number;
}

export async function checkUsfmConflictsAction(
  abbreviation: string,
  incomingBooks: Array<{ osisBook: string; chapters: number[] }>
): Promise<{ conflicts: BookConflict[] }> {
  if (!abbreviation || incomingBooks.length === 0) return { conflicts: [] };

  const trans = await userDb
    .select({ id: translations.id })
    .from(translations)
    .where(eq(translations.abbreviation, abbreviation.toUpperCase()))
    .limit(1);

  if (!trans[0]) return { conflicts: [] };
  const translationId = trans[0].id;

  const conflicts: BookConflict[] = [];

  for (const { osisBook, chapters } of incomingBooks) {
    const book = await getBook(osisBook);
    if (!book) continue;

    const existingRows = await userDb
      .select({ chapter: translationVerses.chapter })
      .from(translationVerses)
      .where(and(
        eq(translationVerses.translationId, translationId),
        eq(translationVerses.bookId, book.id),
      ));

    const existingSet = new Set(existingRows.map(r => r.chapter));
    const conflictingChapters = chapters
      .filter(ch => existingSet.has(ch))
      .sort((a, b) => a - b);

    if (conflictingChapters.length > 0) {
      conflicts.push({
        osisBook,
        conflictingChapters,
        incomingChapters: [...chapters].sort((a, b) => a - b),
        totalBookChapters: book.chapterCount,
      });
    }
  }

  return { conflicts };
}
