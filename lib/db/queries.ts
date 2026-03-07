import { eq, and, asc, inArray, or, gte, lte, gt, lt, sql } from "drizzle-orm";
import { db } from "./index";
import { books, words, verses, translations, translationVerses, paragraphBreaks, characters, characterRefs, speechSections, wordTags, wordTagRefs, lineIndents, passages } from "./schema";
import type { Book, Word, Translation, TranslationVerse, Character, CharacterRef, SpeechSection, WordTag, WordTagRef, Passage } from "./schema";
import type { TextSource, Testament } from "@/lib/morphology/types";

export async function getBooks(testament?: Testament): Promise<Book[]> {
  if (testament) {
    return db
      .select()
      .from(books)
      .where(eq(books.testament, testament))
      .orderBy(asc(books.bookNumber));
  }
  return db.select().from(books).orderBy(asc(books.bookNumber));
}

export async function getBook(osisCode: string): Promise<Book | undefined> {
  const results = await db
    .select()
    .from(books)
    .where(eq(books.osisCode, osisCode))
    .limit(1);
  return results[0];
}

export async function getChapterWords(
  osisBook: string,
  chapter: number,
  textSource: TextSource
): Promise<Word[]> {
  const book = await getBook(osisBook);
  if (!book) return [];

  return db
    .select()
    .from(words)
    .where(
      and(
        eq(words.bookId, book.id),
        eq(words.chapter, chapter),
        eq(words.textSource, textSource)
      )
    )
    .orderBy(asc(words.verse), asc(words.positionInVerse));
}

export async function getWordById(wordId: string): Promise<Word | undefined> {
  const results = await db
    .select()
    .from(words)
    .where(eq(words.wordId, wordId))
    .limit(1);
  return results[0];
}

export async function getChapterCount(osisBook: string): Promise<number> {
  const book = await getBook(osisBook);
  return book?.chapterCount ?? 0;
}

export async function getTranslations(): Promise<Translation[]> {
  return db.select().from(translations).orderBy(asc(translations.abbreviation));
}

export async function getAvailableTranslationsForChapter(
  osisBook: string,
  chapter: number
): Promise<Translation[]> {
  const book = await getBook(osisBook);
  if (!book) return [];

  const rows = await db
    .selectDistinct({ translationId: translationVerses.translationId })
    .from(translationVerses)
    .where(
      and(
        eq(translationVerses.bookId, book.id),
        eq(translationVerses.chapter, chapter)
      )
    );

  const ids = rows.map((r) => r.translationId);
  if (ids.length === 0) return [];

  return db
    .select()
    .from(translations)
    .where(inArray(translations.id, ids))
    .orderBy(asc(translations.abbreviation));
}

export async function getTranslationVerses(
  translationId: number,
  osisBook: string,
  chapter: number
): Promise<TranslationVerse[]> {
  const book = await getBook(osisBook);
  if (!book) return [];

  return db
    .select()
    .from(translationVerses)
    .where(
      and(
        eq(translationVerses.translationId, translationId),
        eq(translationVerses.bookId, book.id),
        eq(translationVerses.chapter, chapter)
      )
    )
    .orderBy(asc(translationVerses.verse));
}

export async function upsertTranslation(name: string, abbreviation: string): Promise<number> {
  const upper = abbreviation.toUpperCase();
  const existing = await db
    .select()
    .from(translations)
    .where(eq(translations.abbreviation, upper))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const result = await db
    .insert(translations)
    .values({ name, abbreviation: upper })
    .returning({ id: translations.id });
  return result[0].id;
}

/** Returns the set of word IDs that are paragraph break start words for a chapter (all sources) */
export async function getChapterParagraphBreaks(
  book: string,
  chapter: number
): Promise<string[]> {
  const rows = await db
    .select({ wordId: paragraphBreaks.wordId })
    .from(paragraphBreaks)
    .where(
      and(
        eq(paragraphBreaks.book, book),
        eq(paragraphBreaks.chapter, chapter)
      )
    );
  return rows.map((r) => r.wordId);
}

/** Toggles a paragraph break for a word. Returns whether the break was added (true) or removed (false). */
export async function toggleParagraphBreak(
  wordId: string,
  book: string,
  chapter: number,
  textSource: string
): Promise<{ added: boolean }> {
  const existing = await db
    .select({ id: paragraphBreaks.id })
    .from(paragraphBreaks)
    .where(eq(paragraphBreaks.wordId, wordId))
    .limit(1);

  if (existing.length > 0) {
    await db.delete(paragraphBreaks).where(eq(paragraphBreaks.wordId, wordId));
    return { added: false };
  } else {
    await db.insert(paragraphBreaks).values({ wordId, book, chapter, textSource });
    return { added: true };
  }
}

/** Group words by verse for display */
export function groupWordsByVerse(wordList: Word[]): Map<number, Word[]> {
  const grouped = new Map<number, Word[]>();
  for (const word of wordList) {
    const existing = grouped.get(word.verse) ?? [];
    existing.push(word);
    grouped.set(word.verse, existing);
  }
  return grouped;
}

// ── Characters (book-scoped) ──────────────────────────────────────────────────

export async function getCharacters(book: string): Promise<Character[]> {
  return db
    .select()
    .from(characters)
    .where(eq(characters.book, book))
    .orderBy(asc(characters.id));
}

export async function createCharacter(name: string, color: string, book: string): Promise<Character> {
  const result = await db
    .insert(characters)
    .values({ name, color, book })
    .returning();
  return result[0];
}

export async function deleteCharacter(id: number): Promise<void> {
  await db.delete(characters).where(eq(characters.id, id));
}

export async function updateCharacter(id: number, name: string, color: string): Promise<Character> {
  const result = await db
    .update(characters)
    .set({ name, color })
    .where(eq(characters.id, id))
    .returning();
  return result[0];
}

// ── Character Refs (chapter-scoped) ──────────────────────────────────────────

export async function getChapterCharacterRefs(
  book: string,
  chapter: number
): Promise<CharacterRef[]> {
  return db
    .select()
    .from(characterRefs)
    .where(
      and(
        eq(characterRefs.book, book),
        eq(characterRefs.chapter, chapter)
      )
    );
}

export async function upsertCharacterRef(
  wordId: string,
  character1Id: number,
  character2Id: number | null,
  book: string,
  chapter: number,
  textSource: string
): Promise<void> {
  await db
    .insert(characterRefs)
    .values({ wordId, character1Id, character2Id, book, chapter, textSource })
    .onConflictDoUpdate({
      target: characterRefs.wordId,
      set: { character1Id, character2Id },
    });
}

export async function removeCharacterRef(wordId: string): Promise<void> {
  await db.delete(characterRefs).where(eq(characterRefs.wordId, wordId));
}

// ── Speech Sections (chapter-scoped) ─────────────────────────────────────────

export async function getChapterSpeechSections(
  book: string,
  chapter: number,
  textSource: string
): Promise<SpeechSection[]> {
  return db
    .select()
    .from(speechSections)
    .where(
      and(
        eq(speechSections.book, book),
        eq(speechSections.chapter, chapter),
        eq(speechSections.textSource, textSource)
      )
    );
}

/**
 * Create or extend a speech section. Deletes any existing sections that overlap
 * [startWordId..endWordId], then merges adjacent same-character sections.
 * Returns the updated full section list for the chapter.
 */
export async function upsertSpeechSection(
  characterId: number,
  startWordId: string,
  endWordId: string,
  book: string,
  chapter: number,
  textSource: string,
  chapterWords: { wordId: string }[]
): Promise<SpeechSection[]> {
  // Build a position index
  const posMap = new Map(chapterWords.map((w, i) => [w.wordId, i]));
  const startPos = posMap.get(startWordId) ?? -1;
  const endPos   = posMap.get(endWordId)   ?? -1;
  if (startPos < 0 || endPos < 0) {
    return getChapterSpeechSections(book, chapter, textSource);
  }
  // Ensure start <= end
  const lo = Math.min(startPos, endPos);
  const hi = Math.max(startPos, endPos);
  const loWordId = chapterWords[lo].wordId;
  const hiWordId = chapterWords[hi].wordId;

  // Load all existing sections for this chapter
  const existing = await getChapterSpeechSections(book, chapter, textSource);

  // Find sections that overlap [lo..hi]
  const overlapping = existing.filter((s) => {
    const si = posMap.get(s.startWordId) ?? -1;
    const ei = posMap.get(s.endWordId)   ?? -1;
    return si <= hi && ei >= lo;
  });

  // Delete overlapping sections
  for (const s of overlapping) {
    await db.delete(speechSections).where(eq(speechSections.id, s.id));
  }

  // Determine expanded range (absorb any overlapping sections)
  let finalLo = lo;
  let finalHi = hi;
  for (const s of overlapping) {
    const si = posMap.get(s.startWordId) ?? lo;
    const ei = posMap.get(s.endWordId)   ?? hi;
    finalLo = Math.min(finalLo, si);
    finalHi = Math.max(finalHi, ei);
  }

  // Check adjacency: sections immediately before/after that share the same character
  const remaining = existing.filter((s) => !overlapping.some((o) => o.id === s.id));
  for (const s of remaining) {
    if (s.characterId !== characterId) continue;
    const si = posMap.get(s.startWordId) ?? -1;
    const ei = posMap.get(s.endWordId)   ?? -1;
    if (ei + 1 === finalLo || si - 1 === finalHi) {
      // Adjacent and same character — merge
      await db.delete(speechSections).where(eq(speechSections.id, s.id));
      finalLo = Math.min(finalLo, si);
      finalHi = Math.max(finalHi, ei);
    }
  }

  await db.insert(speechSections).values({
    characterId,
    startWordId: chapterWords[finalLo].wordId,
    endWordId:   chapterWords[finalHi].wordId,
    book,
    chapter,
    textSource,
  });

  return getChapterSpeechSections(book, chapter, textSource);
}

/**
 * Replace ALL speech sections for a chapter with the supplied list.
 * Used by undo to restore a previous snapshot.
 */
export async function replaceChapterSpeechSections(
  book: string,
  chapter: number,
  textSource: string,
  sections: SpeechSection[]
): Promise<void> {
  await db.delete(speechSections).where(
    and(
      eq(speechSections.book, book),
      eq(speechSections.chapter, chapter),
      eq(speechSections.textSource, textSource)
    )
  );
  if (sections.length > 0) {
    await db.insert(speechSections).values(
      sections.map((s) => ({
        characterId: s.characterId,
        startWordId: s.startWordId,
        endWordId: s.endWordId,
        book: s.book,
        chapter: s.chapter,
        textSource: s.textSource,
      }))
    );
  }
}

/**
 * Remove whichever speech section contains the given word.
 * Returns the updated full section list for the chapter.
 */
export async function removeSpeechSectionContaining(
  wordId: string,
  book: string,
  chapter: number,
  textSource: string,
  chapterWords: { wordId: string }[]
): Promise<SpeechSection[]> {
  const posMap = new Map(chapterWords.map((w, i) => [w.wordId, i]));
  const wordPos = posMap.get(wordId) ?? -1;
  if (wordPos < 0) return getChapterSpeechSections(book, chapter, textSource);

  const existing = await getChapterSpeechSections(book, chapter, textSource);
  const containing = existing.find((s) => {
    const si = posMap.get(s.startWordId) ?? -1;
    const ei = posMap.get(s.endWordId)   ?? -1;
    return si <= wordPos && wordPos <= ei;
  });

  if (containing) {
    await db.delete(speechSections).where(eq(speechSections.id, containing.id));
  }

  return getChapterSpeechSections(book, chapter, textSource);
}

// ── Word / Concept Tags (book-scoped) ─────────────────────────────────────────

export async function getWordTags(book: string): Promise<WordTag[]> {
  return db.select().from(wordTags).where(eq(wordTags.book, book)).orderBy(asc(wordTags.id));
}

export async function createWordTag(
  name: string,
  color: string,
  type: string,
  book: string
): Promise<WordTag> {
  const result = await db.insert(wordTags).values({ name, color, type, book }).returning();
  return result[0];
}

export async function updateWordTag(id: number, name: string, color: string): Promise<WordTag> {
  const result = await db
    .update(wordTags)
    .set({ name, color })
    .where(eq(wordTags.id, id))
    .returning();
  return result[0];
}

export async function deleteWordTag(id: number): Promise<void> {
  await db.delete(wordTags).where(eq(wordTags.id, id));
}

// ── Word Tag Refs (chapter-scoped) ────────────────────────────────────────────

export async function getChapterWordTagRefs(book: string, chapter: number): Promise<WordTagRef[]> {
  return db
    .select()
    .from(wordTagRefs)
    .where(and(eq(wordTagRefs.book, book), eq(wordTagRefs.chapter, chapter)));
}

/** Upsert a word tag ref — wordId is unique so conflict updates tagId. */
export async function upsertWordTagRef(
  wordId: string,
  tagId: number,
  textSource: string,
  book: string,
  chapter: number
): Promise<void> {
  await db
    .insert(wordTagRefs)
    .values({ wordId, tagId, textSource, book, chapter })
    .onConflictDoUpdate({ target: wordTagRefs.wordId, set: { tagId, textSource, book, chapter } });
}

export async function removeWordTagRef(wordId: string): Promise<void> {
  await db.delete(wordTagRefs).where(eq(wordTagRefs.wordId, wordId));
}

// ── Line Indents (chapter-scoped) ─────────────────────────────────────────────

/** Returns all paragraph indent levels for a chapter. */
export async function getChapterLineIndents(
  book: string,
  chapter: number
): Promise<{ wordId: string; indentLevel: number }[]> {
  return db
    .select({ wordId: lineIndents.wordId, indentLevel: lineIndents.indentLevel })
    .from(lineIndents)
    .where(and(eq(lineIndents.book, book), eq(lineIndents.chapter, chapter)));
}

/**
 * Upsert an indent level for the paragraph that starts at `wordId`.
 * Pass `indentLevel = 0` to remove the record (reset to no indent).
 */
export async function setLineIndent(
  wordId: string,
  indentLevel: number,
  textSource: string,
  book: string,
  chapter: number
): Promise<void> {
  if (indentLevel <= 0) {
    await db.delete(lineIndents).where(eq(lineIndents.wordId, wordId));
  } else {
    await db
      .insert(lineIndents)
      .values({ wordId, indentLevel, textSource, book, chapter })
      .onConflictDoUpdate({ target: lineIndents.wordId, set: { indentLevel } });
  }
}

// ── Passages ──────────────────────────────────────────────────────────────────

export async function getPassagesForBook(
  book: string,
  textSource: string
): Promise<Passage[]> {
  return db
    .select()
    .from(passages)
    .where(and(eq(passages.book, book), eq(passages.textSource, textSource)))
    .orderBy(asc(passages.startChapter), asc(passages.startVerse));
}

export async function getPassage(id: number): Promise<Passage | undefined> {
  const results = await db
    .select()
    .from(passages)
    .where(eq(passages.id, id))
    .limit(1);
  return results[0];
}

export async function createPassage(
  book: string,
  textSource: string,
  label: string,
  startChapter: number,
  startVerse: number,
  endChapter: number,
  endVerse: number
): Promise<Passage> {
  const result = await db
    .insert(passages)
    .values({ book, textSource, label, startChapter, startVerse, endChapter, endVerse })
    .returning();
  return result[0];
}

export async function updatePassage(
  id: number,
  updates: Partial<Pick<Passage, "label" | "startChapter" | "startVerse" | "endChapter" | "endVerse">>
): Promise<Passage> {
  const result = await db
    .update(passages)
    .set(updates)
    .where(eq(passages.id, id))
    .returning();
  return result[0];
}

export async function deletePassage(id: number): Promise<void> {
  await db.delete(passages).where(eq(passages.id, id));
}

/**
 * Fetch all words in a passage range. Handles single-chapter and multi-chapter
 * passages, filtering by chapter/verse boundaries on both ends.
 */
export async function getPassageWords(
  osisBook: string,
  textSource: string,
  startChapter: number,
  startVerse: number,
  endChapter: number,
  endVerse: number
): Promise<Word[]> {
  const book = await getBook(osisBook);
  if (!book) return [];

  const baseFilter = and(
    eq(words.bookId, book.id),
    eq(words.textSource, textSource)
  );

  const rangeFilter =
    startChapter === endChapter
      ? and(
          eq(words.chapter, startChapter),
          gte(words.verse, startVerse),
          lte(words.verse, endVerse)
        )
      : or(
          and(eq(words.chapter, startChapter), gte(words.verse, startVerse)),
          and(gt(words.chapter, startChapter), lt(words.chapter, endChapter)),
          and(eq(words.chapter, endChapter), lte(words.verse, endVerse))
        );

  return db
    .select()
    .from(words)
    .where(and(baseFilter, rangeFilter))
    .orderBy(asc(words.chapter), asc(words.verse), asc(words.positionInVerse));
}

/** Returns the highest verse number in a given chapter (used for passage boundary navigation). */
export async function getChapterMaxVerse(
  osisBook: string,
  chapter: number,
  textSource: string
): Promise<number> {
  const book = await getBook(osisBook);
  if (!book) return 0;

  const result = await db
    .select({ maxVerse: sql<number>`max(${words.verse})` })
    .from(words)
    .where(
      and(
        eq(words.bookId, book.id),
        eq(words.chapter, chapter),
        eq(words.textSource, textSource)
      )
    );
  return result[0]?.maxVerse ?? 0;
}
