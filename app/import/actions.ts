"use server";

import { parseBibleComText } from "@/lib/utils/translation-parser";
import { upsertTranslation, getBook } from "@/lib/db/queries";
import { userDb } from "@/lib/db";
import { translations, translationVerses } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
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
