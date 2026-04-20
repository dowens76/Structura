import { eq, and, asc, inArray, or, gte, lte, gt, lt, sql, max, like } from "drizzle-orm";
import { sourceDb, userDb, sourceLookups, lxxLookups, getLxxDb, getUltSqlite } from "./index";
import type { LookupMaps } from "./index";
import { books, words } from "./source-schema";
import type { Word, WordRow } from "./source-schema";
import { translations, translationVerses, paragraphBreaks, paragraphHeadings, characters, characterRefs, speechSections, wordTags, wordTagRefs, lineIndents, sceneBreaks, passages, clauseRelationships, rstRelations, wordArrows, wordFormatting, lineAnnotations } from "./user-schema";
import type { Book, Translation, TranslationVerse, Character, CharacterRef, SpeechSection, WordTag, WordTagRef, Passage, ClauseRelationship, RstRelation, WordArrow, LineAnnotation } from "./schema";
import type { TextSource, Testament } from "@/lib/morphology/types";

// ── Decode helpers ────────────────────────────────────────────────────────────

function decodeWord(row: WordRow, maps: LookupMaps): Word {
  return {
    id:              row.id,
    wordId:          row.wordId,
    bookId:          row.bookId,
    chapter:         row.chapter,
    verse:           row.verse,
    positionInVerse: row.positionInVerse,
    surfaceText:     row.surfaceText,
    surfaceNorm:     row.surfaceNorm,
    lemma:           row.lemma,
    strongNumber:    row.strongNumber,
    morphCode:       row.morphCode,
    language:        maps.languageById[row.languageId] ?? "",
    textSource:      maps.textSourceById[row.textSourceId] ?? "",
    partOfSpeech:    row.partOfSpeechId != null ? (maps.partOfSpeechById[row.partOfSpeechId] ?? null) : null,
    person:          row.personId != null      ? (maps.personById[row.personId] ?? null) : null,
    gender:          row.genderId != null      ? (maps.genderById[row.genderId] ?? null) : null,
    wordNumber:      row.wordNumberId != null  ? (maps.wordNumberById[row.wordNumberId] ?? null) : null,
    tense:           row.tenseId != null       ? (maps.tenseById[row.tenseId] ?? null) : null,
    voice:           row.voiceId != null       ? (maps.voiceById[row.voiceId] ?? null) : null,
    mood:            row.moodId != null        ? (maps.moodById[row.moodId] ?? null) : null,
    stem:            row.stemId != null        ? (maps.stemById[row.stemId] ?? null) : null,
    state:           row.stateId != null       ? (maps.stateById[row.stateId] ?? null) : null,
    verbCase:        row.verbCaseId != null    ? (maps.verbCaseById[row.verbCaseId] ?? null) : null,
  };
}

export async function getBooks(testament?: Testament): Promise<Book[]> {
  if (testament) {
    return sourceDb
      .select()
      .from(books)
      .where(eq(books.testament, testament))
      .orderBy(asc(books.bookNumber));
  }
  return sourceDb.select().from(books).orderBy(asc(books.bookNumber));
}

export async function getBooksBySource(textSource: string): Promise<Book[]> {
  return sourceDb
    .select()
    .from(books)
    .where(eq(books.textSource, textSource))
    .orderBy(asc(books.bookNumber));
}

/**
 * Returns all books that have at least one word with the given textSource.
 * Unlike getBooksBySource (which filters by the book record's textSource),
 * this also finds canonical OT books whose record is stored under a different
 * source (e.g. "OSHB") but whose words include STEPBIBLE_LXX entries.
 * Results are ordered by book_number for a consistent listing.
 */
export async function getBooksWithWords(textSource: string): Promise<Book[]> {
  if (textSource === "STEPBIBLE_LXX") {
    const lxxDb = getLxxDb();
    if (!lxxDb) return [];
    const bookIdRows = await lxxDb.selectDistinct({ bookId: words.bookId }).from(words);
    const ids = bookIdRows.map((r) => r.bookId);
    if (ids.length === 0) return [];
    return sourceDb.select().from(books).where(inArray(books.id, ids)).orderBy(asc(books.bookNumber));
  }
  const tsId = sourceLookups.textSourceByValue[textSource];
  if (tsId == null) return [];
  const rows = await sourceDb
    .selectDistinct({ book: books })
    .from(books)
    .innerJoin(words, eq(words.bookId, books.id))
    .where(eq(words.textSourceId, tsId))
    .orderBy(asc(books.bookNumber));
  return rows.map((r) => r.book);
}

/**
 * Returns the highest chapter number that exists in the words table for a
 * given book / textSource combination.  Use this instead of book.chapterCount
 * when the book record belongs to a different source (e.g. canonical OSHB
 * books viewed as STEPBIBLE_LXX, which can have more or fewer chapters).
 */
export async function getMaxChapterForSource(
  osisBook: string,
  textSource: string
): Promise<number> {
  const book = await getBook(osisBook);
  if (!book) return 1;
  if (textSource === "STEPBIBLE_LXX") {
    const lxxDb = getLxxDb();
    if (!lxxDb) return book.chapterCount;
    const r = await lxxDb.select({ maxCh: max(words.chapter) }).from(words).where(eq(words.bookId, book.id));
    return r[0]?.maxCh ?? book.chapterCount;
  }
  const tsId = sourceLookups.textSourceByValue[textSource];
  if (tsId == null) return book.chapterCount;
  const result = await sourceDb
    .select({ maxCh: max(words.chapter) })
    .from(words)
    .where(and(eq(words.bookId, book.id), eq(words.textSourceId, tsId)));
  return result[0]?.maxCh ?? book.chapterCount;
}

export async function getBook(osisCode: string): Promise<Book | undefined> {
  const results = await sourceDb
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

  if (textSource === "STEPBIBLE_LXX") {
    const lxxDb = getLxxDb();
    if (!lxxDb) return [];
    const rows = await lxxDb
      .select()
      .from(words)
      .where(and(eq(words.bookId, book.id), eq(words.chapter, chapter)))
      .orderBy(asc(words.verse), asc(words.positionInVerse));
    return rows.map((r) => decodeWord(r, lxxLookups));
  }
  const tsId = sourceLookups.textSourceByValue[textSource];
  if (tsId == null) return [];
  const rows = await sourceDb
    .select()
    .from(words)
    .where(and(eq(words.bookId, book.id), eq(words.chapter, chapter), eq(words.textSourceId, tsId)))
    .orderBy(asc(words.verse), asc(words.positionInVerse));
  return rows.map((r) => decodeWord(r, sourceLookups));
}

export async function getWordById(wordId: string): Promise<Word | undefined> {
  if (wordId.startsWith("LXX.")) {
    const lxxDb = getLxxDb();
    if (!lxxDb) return undefined;
    const results = await lxxDb.select().from(words).where(eq(words.wordId, wordId)).limit(1);
    return results[0] ? decodeWord(results[0], lxxLookups) : undefined;
  }
  const results = await sourceDb.select().from(words).where(eq(words.wordId, wordId)).limit(1);
  return results[0] ? decodeWord(results[0], sourceLookups) : undefined;
}

export async function getChapterCount(osisBook: string): Promise<number> {
  const book = await getBook(osisBook);
  return book?.chapterCount ?? 0;
}

// Translations are workspace-independent — all imported translations are shared
// across workspaces. The workspaceId parameter is accepted for API compatibility
// but is no longer used as a filter.

export async function getTranslations(_workspaceId?: number): Promise<Translation[]> {
  return userDb
    .select()
    .from(translations)
    .orderBy(asc(translations.abbreviation));
}

export async function getAvailableTranslationsForChapter(
  osisBook: string,
  chapter: number,
  _workspaceId?: number
): Promise<Translation[]> {
  // Match by osis_ref prefix (e.g. "1Sam.1.") — avoids dependency on book_id
  // which may differ across database versions.
  const prefix = `${osisBook}.${chapter}.`;

  const rows = await userDb
    .selectDistinct({ translationId: translationVerses.translationId })
    .from(translationVerses)
    .where(like(translationVerses.osisRef, `${prefix}%`));

  const ids = rows.map((r) => r.translationId);
  if (ids.length === 0) return [];

  return userDb
    .select()
    .from(translations)
    .where(inArray(translations.id, ids))
    .orderBy(asc(translations.abbreviation));
}

export async function getTranslationVerses(
  translationId: number,
  osisBook: string,
  chapter: number,
  _workspaceId?: number
): Promise<TranslationVerse[]> {
  const prefix = `${osisBook}.${chapter}.`;

  return userDb
    .select()
    .from(translationVerses)
    .where(
      and(
        eq(translationVerses.translationId, translationId),
        like(translationVerses.osisRef, `${prefix}%`)
      )
    )
    .orderBy(asc(translationVerses.verse));
}

export async function upsertTranslation(name: string, abbreviation: string, _workspaceId?: number): Promise<number> {
  const upper = abbreviation.toUpperCase();
  const existing = await userDb
    .select()
    .from(translations)
    .where(eq(translations.abbreviation, upper))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const result = await userDb
    .insert(translations)
    .values({ name, abbreviation: upper, workspaceId: 1 })
    .returning({ id: translations.id });
  return result[0].id;
}

/** Returns the set of word IDs that are paragraph break start words for a chapter (all sources) */
export async function getChapterParagraphBreaks(
  book: string,
  chapter: number,
  workspaceId: number
): Promise<string[]> {
  const rows = await userDb
    .select({ wordId: paragraphBreaks.wordId })
    .from(paragraphBreaks)
    .where(
      and(
        eq(paragraphBreaks.workspaceId, workspaceId),
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
  textSource: string,
  workspaceId: number
): Promise<{ added: boolean }> {
  const existing = await userDb
    .select({ id: paragraphBreaks.id })
    .from(paragraphBreaks)
    .where(and(eq(paragraphBreaks.workspaceId, workspaceId), eq(paragraphBreaks.wordId, wordId)))
    .limit(1);

  if (existing.length > 0) {
    await userDb.delete(paragraphBreaks).where(
      and(eq(paragraphBreaks.workspaceId, workspaceId), eq(paragraphBreaks.wordId, wordId))
    );
    return { added: false };
  } else {
    await userDb.insert(paragraphBreaks).values({ wordId, book, chapter, textSource, workspaceId });
    return { added: true };
  }
}

// ── Paragraph headings ────────────────────────────────────────────────────────

export async function getChapterParagraphHeadings(
  book: string,
  chapter: number,
  workspaceId: number
): Promise<{ verse: number; heading: string }[]> {
  return userDb
    .select({ verse: paragraphHeadings.verse, heading: paragraphHeadings.heading })
    .from(paragraphHeadings)
    .where(
      and(
        eq(paragraphHeadings.workspaceId, workspaceId),
        eq(paragraphHeadings.book, book),
        eq(paragraphHeadings.chapter, chapter)
      )
    );
}

export async function setParagraphHeading(
  book: string,
  chapter: number,
  verse: number,
  heading: string,
  workspaceId: number
): Promise<void> {
  if (!heading.trim()) {
    await userDb.delete(paragraphHeadings).where(
      and(
        eq(paragraphHeadings.workspaceId, workspaceId),
        eq(paragraphHeadings.book, book),
        eq(paragraphHeadings.chapter, chapter),
        eq(paragraphHeadings.verse, verse)
      )
    );
    return;
  }
  await userDb
    .insert(paragraphHeadings)
    .values({ workspaceId, book, chapter, verse, heading: heading.trim() })
    .onConflictDoUpdate({
      target: [paragraphHeadings.workspaceId, paragraphHeadings.book, paragraphHeadings.chapter, paragraphHeadings.verse],
      set: { heading: heading.trim() },
    });
}

// ── Section breaks ────────────────────────────────────────────────────────────

/**
 * Returns all section breaks for a chapter sorted by (chapter, verse, level).
 * Multiple rows can exist per wordId (one per level).
 */
export async function getChapterSceneBreaks(
  book: string,
  chapter: number,
  workspaceId: number
): Promise<{ wordId: string; heading: string | null; level: number; verse: number; outOfSequence: boolean; extendedThrough: number | null }[]> {
  const rows = await userDb
    .select({
      wordId:          sceneBreaks.wordId,
      heading:         sceneBreaks.heading,
      level:           sceneBreaks.level,
      verse:           sceneBreaks.verse,
      outOfSequence:   sceneBreaks.outOfSequence,
      extendedThrough: sceneBreaks.extendedThrough,
    })
    .from(sceneBreaks)
    .where(and(eq(sceneBreaks.workspaceId, workspaceId), eq(sceneBreaks.book, book), eq(sceneBreaks.chapter, chapter)))
    .orderBy(asc(sceneBreaks.verse), asc(sceneBreaks.level));
  return rows;
}

/**
 * Returns all section breaks for a whole book sorted by (chapter, verse, level).
 * Used for outline export and cross-chapter verse range computation.
 */
export async function getBookSceneBreaks(
  book: string,
  textSource: string,
  workspaceId: number
): Promise<{ wordId: string; heading: string | null; level: number; chapter: number; verse: number; outOfSequence: boolean; extendedThrough: number | null }[]> {
  const rows = await userDb
    .select({
      wordId:          sceneBreaks.wordId,
      heading:         sceneBreaks.heading,
      level:           sceneBreaks.level,
      chapter:         sceneBreaks.chapter,
      verse:           sceneBreaks.verse,
      outOfSequence:   sceneBreaks.outOfSequence,
      extendedThrough: sceneBreaks.extendedThrough,
    })
    .from(sceneBreaks)
    .where(and(eq(sceneBreaks.workspaceId, workspaceId), eq(sceneBreaks.book, book), eq(sceneBreaks.textSource, textSource)))
    .orderBy(asc(sceneBreaks.chapter), asc(sceneBreaks.verse), asc(sceneBreaks.level));
  return rows;
}

/**
 * Returns the maximum verse number per chapter for a book/source combination.
 * Used to compute cross-chapter verse ranges for section breaks.
 */
export async function getBookChapterMaxVerses(
  osisBook: string,
  textSource: string
): Promise<Map<number, number>> {
  const bookRow = await getBook(osisBook);
  if (!bookRow) return new Map();
  const db = textSource === "STEPBIBLE_LXX" ? (getLxxDb() ?? sourceDb) : sourceDb;
  const tsId = textSource === "STEPBIBLE_LXX" ? null : (sourceLookups.textSourceByValue[textSource] ?? null);
  const whereClause = tsId != null
    ? and(eq(words.bookId, bookRow.id), eq(words.textSourceId, tsId))
    : eq(words.bookId, bookRow.id);
  const rows = await db
    .select({
      chapter:  words.chapter,
      maxVerse: sql<number>`max(${words.verse})`,
    })
    .from(words)
    .where(whereClause)
    .groupBy(words.chapter)
    .orderBy(asc(words.chapter));
  return new Map(rows.map((r) => [r.chapter, r.maxVerse]));
}

/**
 * Toggles a section break for a specific (wordId, level) pair.
 * Adding also inserts a paragraph break (if not present for any level at this wordId).
 * Removing only deletes the paragraph break if no other section breaks remain at this wordId.
 * Returns whether the break was added (true) or removed (false).
 */
export async function toggleSceneBreak(
  wordId: string,
  book: string,
  chapter: number,
  verse: number,
  textSource: string,
  level = 1,
  workspaceId: number
): Promise<{ added: boolean }> {
  // Check if this specific (wordId, level) already exists
  const existing = await userDb
    .select({ id: sceneBreaks.id })
    .from(sceneBreaks)
    .where(and(eq(sceneBreaks.workspaceId, workspaceId), eq(sceneBreaks.wordId, wordId), eq(sceneBreaks.level, level)))
    .limit(1);

  if (existing.length > 0) {
    // Remove this specific (wordId, level) section break
    await userDb.delete(sceneBreaks).where(
      and(eq(sceneBreaks.workspaceId, workspaceId), eq(sceneBreaks.wordId, wordId), eq(sceneBreaks.level, level))
    );
    // Only remove paragraph break if no other section breaks remain at this wordId
    const remaining = await userDb
      .select({ id: sceneBreaks.id })
      .from(sceneBreaks)
      .where(and(eq(sceneBreaks.workspaceId, workspaceId), eq(sceneBreaks.wordId, wordId)))
      .limit(1);
    if (remaining.length === 0) {
      await userDb.delete(paragraphBreaks).where(
        and(eq(paragraphBreaks.workspaceId, workspaceId), eq(paragraphBreaks.wordId, wordId))
      );
    }
    return { added: false };
  } else {
    // Add this (wordId, level) section break with verse
    await userDb.insert(sceneBreaks).values({ wordId, book, chapter, verse, textSource, level, workspaceId });
    // Ensure a paragraph break exists (only if not already present)
    const pbExists = await userDb
      .select({ id: paragraphBreaks.id })
      .from(paragraphBreaks)
      .where(and(eq(paragraphBreaks.workspaceId, workspaceId), eq(paragraphBreaks.wordId, wordId)))
      .limit(1);
    if (pbExists.length === 0) {
      await userDb.insert(paragraphBreaks).values({ wordId, book, chapter, textSource, workspaceId });
    }
    return { added: true };
  }
}

/** Deletes a specific (wordId, level) section break. Removes paragraph break if no others remain. */
export async function deleteSceneBreak(wordId: string, level: number, workspaceId: number): Promise<void> {
  await userDb.delete(sceneBreaks).where(
    and(eq(sceneBreaks.workspaceId, workspaceId), eq(sceneBreaks.wordId, wordId), eq(sceneBreaks.level, level))
  );
  const remaining = await userDb
    .select({ id: sceneBreaks.id })
    .from(sceneBreaks)
    .where(and(eq(sceneBreaks.workspaceId, workspaceId), eq(sceneBreaks.wordId, wordId)))
    .limit(1);
  if (remaining.length === 0) {
    await userDb.delete(paragraphBreaks).where(
      and(eq(paragraphBreaks.workspaceId, workspaceId), eq(paragraphBreaks.wordId, wordId))
    );
  }
}

/** Updates the heading text for a specific (wordId, level) section break (null clears it). */
export async function updateSceneBreakHeading(
  wordId: string,
  level: number,
  heading: string | null,
  workspaceId: number
): Promise<void> {
  await userDb
    .update(sceneBreaks)
    .set({ heading: heading && heading.trim() ? heading.trim() : null })
    .where(and(eq(sceneBreaks.workspaceId, workspaceId), eq(sceneBreaks.wordId, wordId), eq(sceneBreaks.level, level)));
}

/** Marks or unmarks a specific (wordId, level) section break as out of chronological sequence. */
export async function updateSceneBreakOutOfSequence(
  wordId: string,
  level: number,
  outOfSequence: boolean,
  workspaceId: number
): Promise<void> {
  await userDb
    .update(sceneBreaks)
    .set({ outOfSequence })
    .where(and(eq(sceneBreaks.workspaceId, workspaceId), eq(sceneBreaks.wordId, wordId), eq(sceneBreaks.level, level)));
}

/**
 * Sets the "extended through" chapter for a Psalms section break (null = no extension).
 * Only meaningful for book "Ps" — allows grouping adjacent psalms (e.g. Ps 9+10).
 */
export async function updateSceneBreakExtendedThrough(
  wordId: string,
  level: number,
  extendedThrough: number | null,
  workspaceId: number
): Promise<void> {
  await userDb
    .update(sceneBreaks)
    .set({ extendedThrough })
    .where(and(eq(sceneBreaks.workspaceId, workspaceId), eq(sceneBreaks.wordId, wordId), eq(sceneBreaks.level, level)));
}

/**
 * One-time migration: copies passage labels → level-2 section breaks.
 * Idempotent — uses onConflictDoNothing so re-running is safe.
 */
export async function migratePassageLabelsToSectionBreaks(workspaceId: number): Promise<void> {
  // Fetch all passages that have a non-empty label
  const labelledPassages = await userDb
    .select()
    .from(passages)
    .where(and(eq(passages.workspaceId, workspaceId), sql`trim(${passages.label}) != ''`));

  if (labelledPassages.length === 0) return;

  for (const passage of labelledPassages) {
    // Find the first word at (book, textSource, startChapter, startVerse)
    const bookRow = await getBook(passage.book);
    if (!bookRow) continue;

    const isLxx = passage.textSource === "STEPBIBLE_LXX";
    const db = isLxx ? (getLxxDb() ?? sourceDb) : sourceDb;
    const tsId = isLxx ? null : (sourceLookups.textSourceByValue[passage.textSource] ?? null);
    const firstWords = await db
      .select({ wordId: words.wordId, verse: words.verse })
      .from(words)
      .where(
        and(
          eq(words.bookId, bookRow.id),
          ...(tsId != null ? [eq(words.textSourceId, tsId)] : []),
          eq(words.chapter, passage.startChapter),
          eq(words.verse, passage.startVerse)
        )
      )
      .orderBy(asc(words.positionInVerse))
      .limit(1);

    if (firstWords.length === 0) continue;

    const { wordId, verse } = firstWords[0];

    // Insert level-2 section break for this passage label (ignore if already exists)
    await userDb
      .insert(sceneBreaks)
      .values({
        wordId,
        heading: passage.label.trim(),
        level: 2,
        verse,
        textSource: passage.textSource,
        book: passage.book,
        chapter: passage.startChapter,
        workspaceId,
      })
      .onConflictDoNothing();

    // Ensure a paragraph break exists at this position
    await userDb
      .insert(paragraphBreaks)
      .values({
        wordId,
        textSource: passage.textSource,
        book: passage.book,
        chapter: passage.startChapter,
        workspaceId,
      })
      .onConflictDoNothing();
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

export async function getCharacters(book: string, workspaceId: number): Promise<Character[]> {
  return userDb
    .select()
    .from(characters)
    .where(and(eq(characters.workspaceId, workspaceId), eq(characters.book, book)))
    .orderBy(asc(characters.id));
}

export async function createCharacter(name: string, color: string, book: string, workspaceId: number): Promise<Character> {
  const result = await userDb
    .insert(characters)
    .values({ name, color, book, workspaceId })
    .returning();
  return result[0];
}

export async function deleteCharacter(id: number): Promise<void> {
  await userDb.delete(characters).where(eq(characters.id, id));
}

export async function updateCharacter(id: number, name: string, color: string): Promise<Character> {
  const result = await userDb
    .update(characters)
    .set({ name, color })
    .where(eq(characters.id, id))
    .returning();
  return result[0];
}

// ── Character Refs (chapter-scoped) ──────────────────────────────────────────

export async function getChapterCharacterRefs(
  book: string,
  chapter: number,
  workspaceId: number
): Promise<CharacterRef[]> {
  return userDb
    .select()
    .from(characterRefs)
    .where(
      and(
        eq(characterRefs.workspaceId, workspaceId),
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
  textSource: string,
  workspaceId: number
): Promise<void> {
  await userDb
    .insert(characterRefs)
    .values({ wordId, character1Id, character2Id, book, chapter, textSource, workspaceId })
    .onConflictDoUpdate({
      target: [characterRefs.workspaceId, characterRefs.wordId],
      set: { character1Id, character2Id },
    });
}

export async function removeCharacterRef(wordId: string, workspaceId: number): Promise<void> {
  await userDb.delete(characterRefs).where(
    and(eq(characterRefs.workspaceId, workspaceId), eq(characterRefs.wordId, wordId))
  );
}

// ── Speech Sections (chapter-scoped) ─────────────────────────────────────────

export async function getChapterSpeechSections(
  book: string,
  chapter: number,
  textSource: string,
  workspaceId: number
): Promise<SpeechSection[]> {
  return userDb
    .select()
    .from(speechSections)
    .where(
      and(
        eq(speechSections.workspaceId, workspaceId),
        eq(speechSections.book, book),
        eq(speechSections.chapter, chapter),
        eq(speechSections.textSource, textSource)
      )
    );
}

/**
 * Create or extend a speech section. Supports nested speech boxes:
 * - Same character + any overlap → delete and merge (existing behaviour).
 * - Different character + fully contained (one range completely inside the other)
 *   → keep both; the ranges nest visually.
 * - Different character + partial overlap → delete the conflicting section
 *   (the new box wins the disputed words).
 * Returns the updated full section list for the chapter.
 */
export async function upsertSpeechSection(
  characterId: number,
  startWordId: string,
  endWordId: string,
  book: string,
  chapter: number,
  textSource: string,
  chapterWords: { wordId: string }[],
  workspaceId: number
): Promise<SpeechSection[]> {
  // Build a position index
  const posMap = new Map(chapterWords.map((w, i) => [w.wordId, i]));
  const startPos = posMap.get(startWordId) ?? -1;
  const endPos   = posMap.get(endWordId)   ?? -1;
  if (startPos < 0 || endPos < 0) {
    return getChapterSpeechSections(book, chapter, textSource, workspaceId);
  }
  // Ensure start <= end
  const lo = Math.min(startPos, endPos);
  const hi = Math.max(startPos, endPos);

  // Load all existing sections for this chapter
  const existing = await getChapterSpeechSections(book, chapter, textSource, workspaceId);

  // Classify overlapping sections
  const overlapping = existing.filter((s) => {
    const si = posMap.get(s.startWordId) ?? -1;
    const ei = posMap.get(s.endWordId)   ?? -1;
    return si <= hi && ei >= lo;
  });

  const sameCharOverlapping  = overlapping.filter((s) => s.characterId === characterId);
  const diffCharOverlapping  = overlapping.filter((s) => s.characterId !== characterId);

  // Different-character sections: only delete partial overlaps.
  // Fully-contained sections (either direction) are kept to allow nesting.
  const diffCharToDelete = diffCharOverlapping.filter((s) => {
    const si = posMap.get(s.startWordId) ?? -1;
    const ei = posMap.get(s.endWordId)   ?? -1;
    const newContainsExisting = lo <= si && ei <= hi; // existing is inside new range
    const existingContainsNew = si <= lo && hi <= ei; // new is inside existing range
    return !newContainsExisting && !existingContainsNew; // partial overlap → delete
  });

  // Delete same-character overlaps + partially-overlapping different-character ones
  const toDelete = [...sameCharOverlapping, ...diffCharToDelete];
  for (const s of toDelete) {
    await userDb.delete(speechSections).where(eq(speechSections.id, s.id));
  }

  // Expand range only by absorbing same-character deleted sections
  let finalLo = lo;
  let finalHi = hi;
  for (const s of sameCharOverlapping) {
    const si = posMap.get(s.startWordId) ?? lo;
    const ei = posMap.get(s.endWordId)   ?? hi;
    finalLo = Math.min(finalLo, si);
    finalHi = Math.max(finalHi, ei);
  }

  // Check adjacency: sections immediately before/after that share the same character
  const remaining = existing.filter((s) => !toDelete.some((o) => o.id === s.id));
  for (const s of remaining) {
    if (s.characterId !== characterId) continue;
    const si = posMap.get(s.startWordId) ?? -1;
    const ei = posMap.get(s.endWordId)   ?? -1;
    if (ei + 1 === finalLo || si - 1 === finalHi) {
      // Adjacent and same character — merge
      await userDb.delete(speechSections).where(eq(speechSections.id, s.id));
      finalLo = Math.min(finalLo, si);
      finalHi = Math.max(finalHi, ei);
    }
  }

  await userDb.insert(speechSections).values({
    characterId,
    startWordId: chapterWords[finalLo].wordId,
    endWordId:   chapterWords[finalHi].wordId,
    book,
    chapter,
    textSource,
    workspaceId,
  });

  return getChapterSpeechSections(book, chapter, textSource, workspaceId);
}

/**
 * Replace ALL speech sections for a chapter with the supplied list.
 * Used by undo to restore a previous snapshot.
 */
export async function replaceChapterSpeechSections(
  book: string,
  chapter: number,
  textSource: string,
  sections: SpeechSection[],
  workspaceId: number
): Promise<void> {
  await userDb.delete(speechSections).where(
    and(
      eq(speechSections.workspaceId, workspaceId),
      eq(speechSections.book, book),
      eq(speechSections.chapter, chapter),
      eq(speechSections.textSource, textSource)
    )
  );
  if (sections.length > 0) {
    await userDb.insert(speechSections).values(
      sections.map((s) => ({
        characterId: s.characterId,
        startWordId: s.startWordId,
        endWordId: s.endWordId,
        book: s.book,
        chapter: s.chapter,
        textSource: s.textSource,
        workspaceId,
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
  chapterWords: { wordId: string }[],
  workspaceId: number
): Promise<SpeechSection[]> {
  const posMap = new Map(chapterWords.map((w, i) => [w.wordId, i]));
  const wordPos = posMap.get(wordId) ?? -1;
  if (wordPos < 0) return getChapterSpeechSections(book, chapter, textSource, workspaceId);

  const existing = await getChapterSpeechSections(book, chapter, textSource, workspaceId);
  const containing = existing.find((s) => {
    const si = posMap.get(s.startWordId) ?? -1;
    const ei = posMap.get(s.endWordId)   ?? -1;
    return si <= wordPos && wordPos <= ei;
  });

  if (containing) {
    await userDb.delete(speechSections).where(eq(speechSections.id, containing.id));
  }

  return getChapterSpeechSections(book, chapter, textSource, workspaceId);
}

export async function updateSpeechSectionCharacter(
  sectionId: number,
  newCharacterId: number,
  book: string,
  chapter: number,
  textSource: string,
  workspaceId: number
): Promise<SpeechSection[]> {
  await userDb
    .update(speechSections)
    .set({ characterId: newCharacterId })
    .where(eq(speechSections.id, sectionId));
  return getChapterSpeechSections(book, chapter, textSource, workspaceId);
}

// ── Word / Concept Tags (book-scoped) ─────────────────────────────────────────

export async function getWordTags(book: string, workspaceId: number): Promise<WordTag[]> {
  return userDb
    .select()
    .from(wordTags)
    .where(and(eq(wordTags.workspaceId, workspaceId), eq(wordTags.book, book)))
    .orderBy(asc(wordTags.id));
}

export async function createWordTag(
  name: string,
  color: string,
  type: string,
  book: string,
  workspaceId: number
): Promise<WordTag> {
  const result = await userDb.insert(wordTags).values({ name, color, type, book, workspaceId }).returning();
  return result[0];
}

export async function updateWordTag(id: number, name: string, color: string): Promise<WordTag> {
  const result = await userDb
    .update(wordTags)
    .set({ name, color })
    .where(eq(wordTags.id, id))
    .returning();
  return result[0];
}

export async function deleteWordTag(id: number): Promise<void> {
  await userDb.delete(wordTags).where(eq(wordTags.id, id));
}

// ── Word Tag Refs (chapter-scoped) ────────────────────────────────────────────

export async function getChapterWordTagRefs(book: string, chapter: number, workspaceId: number): Promise<WordTagRef[]> {
  return userDb
    .select()
    .from(wordTagRefs)
    .where(and(eq(wordTagRefs.workspaceId, workspaceId), eq(wordTagRefs.book, book), eq(wordTagRefs.chapter, chapter)));
}

/** Upsert a word tag ref — wordId is unique so conflict updates tagId. */
export async function upsertWordTagRef(
  wordId: string,
  tagId: number,
  textSource: string,
  book: string,
  chapter: number,
  workspaceId: number
): Promise<void> {
  await userDb
    .insert(wordTagRefs)
    .values({ wordId, tagId, textSource, book, chapter, workspaceId })
    .onConflictDoUpdate({ target: [wordTagRefs.workspaceId, wordTagRefs.wordId], set: { tagId, textSource, book, chapter } });
}

export async function removeWordTagRef(wordId: string, workspaceId: number): Promise<void> {
  await userDb.delete(wordTagRefs).where(
    and(eq(wordTagRefs.workspaceId, workspaceId), eq(wordTagRefs.wordId, wordId))
  );
}

// ── Line Indents (chapter-scoped) ─────────────────────────────────────────────

/** Returns all paragraph indent levels for a chapter. */
export async function getChapterLineIndents(
  book: string,
  chapter: number,
  workspaceId: number
): Promise<{ wordId: string; indentLevel: number }[]> {
  return userDb
    .select({ wordId: lineIndents.wordId, indentLevel: lineIndents.indentLevel })
    .from(lineIndents)
    .where(and(eq(lineIndents.workspaceId, workspaceId), eq(lineIndents.book, book), eq(lineIndents.chapter, chapter)));
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
  chapter: number,
  workspaceId: number
): Promise<void> {
  if (indentLevel <= 0) {
    await userDb.delete(lineIndents).where(
      and(eq(lineIndents.workspaceId, workspaceId), eq(lineIndents.wordId, wordId))
    );
  } else {
    await userDb
      .insert(lineIndents)
      .values({ wordId, indentLevel, textSource, book, chapter, workspaceId })
      .onConflictDoUpdate({ target: [lineIndents.workspaceId, lineIndents.wordId], set: { indentLevel } });
  }
}

// ── Passages ──────────────────────────────────────────────────────────────────

export async function getPassagesForBook(
  book: string,
  textSource: string,
  workspaceId: number
): Promise<Passage[]> {
  return userDb
    .select()
    .from(passages)
    .where(and(eq(passages.workspaceId, workspaceId), eq(passages.book, book), eq(passages.textSource, textSource)))
    .orderBy(asc(passages.startChapter), asc(passages.startVerse));
}

export async function getPassage(id: number): Promise<Passage | undefined> {
  const results = await userDb
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
  endVerse: number,
  workspaceId: number
): Promise<Passage> {
  const result = await userDb
    .insert(passages)
    .values({ book, textSource, label, startChapter, startVerse, endChapter, endVerse, workspaceId })
    .returning();
  return result[0];
}

export async function updatePassage(
  id: number,
  updates: Partial<Pick<Passage, "label" | "startChapter" | "startVerse" | "endChapter" | "endVerse">>
): Promise<Passage> {
  const result = await userDb
    .update(passages)
    .set(updates)
    .where(eq(passages.id, id))
    .returning();
  return result[0];
}

export async function deletePassage(id: number): Promise<void> {
  await userDb.delete(passages).where(eq(passages.id, id));
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

  const isLxx = textSource === "STEPBIBLE_LXX";
  const db = isLxx ? (getLxxDb() ?? sourceDb) : sourceDb;
  const maps = isLxx ? lxxLookups : sourceLookups;
  const tsId = isLxx ? null : (sourceLookups.textSourceByValue[textSource] ?? null);
  const baseFilter = tsId != null
    ? and(eq(words.bookId, book.id), eq(words.textSourceId, tsId))
    : eq(words.bookId, book.id);

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

  const rows = await db
    .select()
    .from(words)
    .where(and(baseFilter, rangeFilter))
    .orderBy(asc(words.chapter), asc(words.verse), asc(words.positionInVerse));
  return rows.map((r) => decodeWord(r, maps));
}

// ── Clause Relationships ──────────────────────────────────────────────────────

export async function getChapterClauseRelationships(
  book: string,
  chapter: number,
  textSource: string,
  workspaceId: number
): Promise<ClauseRelationship[]> {
  return userDb
    .select()
    .from(clauseRelationships)
    .where(
      and(
        eq(clauseRelationships.workspaceId, workspaceId),
        eq(clauseRelationships.book, book),
        eq(clauseRelationships.chapter, chapter),
        eq(clauseRelationships.textSource, textSource)
      )
    );
}

export async function createClauseRelationship(
  fromSegWordId: string,
  toSegWordId: string,
  relType: string,
  book: string,
  chapter: number,
  textSource: string,
  workspaceId: number
): Promise<ClauseRelationship> {
  const [row] = await userDb
    .insert(clauseRelationships)
    .values({ fromSegWordId, toSegWordId, relType, book, chapter, textSource, workspaceId })
    .returning();
  return row;
}

export async function deleteClauseRelationship(id: number): Promise<void> {
  await userDb.delete(clauseRelationships).where(eq(clauseRelationships.id, id));
}

// ── RST Relations ─────────────────────────────────────────────────────────────

export async function getChapterRstRelations(
  book: string,
  chapter: number,
  textSource: string,
  workspaceId: number
): Promise<RstRelation[]> {
  return userDb
    .select()
    .from(rstRelations)
    .where(
      and(
        eq(rstRelations.workspaceId, workspaceId),
        eq(rstRelations.book, book),
        eq(rstRelations.chapter, chapter),
        eq(rstRelations.textSource, textSource)
      )
    )
    .orderBy(asc(rstRelations.groupId), asc(rstRelations.sortOrder));
}

export async function createRstRelationGroup(
  groupId: string,
  members: { segWordId: string; role: "nucleus" | "satellite"; sortOrder: number }[],
  relType: string,
  book: string,
  chapter: number,
  textSource: string,
  workspaceId: number
): Promise<RstRelation[]> {
  const rows = await userDb
    .insert(rstRelations)
    .values(
      members.map((m) => ({
        groupId,
        segWordId: m.segWordId,
        role: m.role,
        relType,
        sortOrder: m.sortOrder,
        book,
        chapter,
        textSource,
        workspaceId,
      }))
    )
    .returning();
  return rows;
}

export async function deleteRstRelationGroup(groupId: string, workspaceId: number): Promise<void> {
  await userDb.delete(rstRelations).where(
    and(eq(rstRelations.workspaceId, workspaceId), eq(rstRelations.groupId, groupId))
  );
}

export async function deleteRstRelation(id: number): Promise<void> {
  await userDb.delete(rstRelations).where(eq(rstRelations.id, id));
}

export async function updateRstRelationGroupType(
  groupId: string,
  newRelType: string,
  workspaceId: number
): Promise<void> {
  await userDb
    .update(rstRelations)
    .set({ relType: newRelType })
    .where(and(eq(rstRelations.workspaceId, workspaceId), eq(rstRelations.groupId, groupId)));
}

// ── Word Arrows ───────────────────────────────────────────────────────────────

export async function getChapterWordArrows(
  book: string,
  chapter: number,
  textSource: string,
  workspaceId: number
): Promise<WordArrow[]> {
  return userDb
    .select()
    .from(wordArrows)
    .where(
      and(
        eq(wordArrows.workspaceId, workspaceId),
        eq(wordArrows.book, book),
        eq(wordArrows.chapter, chapter),
        eq(wordArrows.textSource, textSource)
      )
    );
}

export async function createWordArrow(
  fromWordId: string,
  toWordId: string,
  book: string,
  chapter: number,
  textSource: string,
  workspaceId: number,
  label?: string
): Promise<WordArrow> {
  const [row] = await userDb
    .insert(wordArrows)
    .values({ fromWordId, toWordId, book, chapter, textSource, workspaceId, label: label ?? null })
    .returning();
  return row;
}

export async function deleteWordArrow(id: number): Promise<void> {
  await userDb.delete(wordArrows).where(eq(wordArrows.id, id));
}

// ── Word Formatting (chapter-scoped) ──────────────────────────────────────────

/** Returns all bold/italic formatting entries for a chapter. */
export async function getChapterWordFormatting(
  book: string,
  chapter: number,
  workspaceId: number
): Promise<{ wordId: string; isBold: boolean; isItalic: boolean }[]> {
  return userDb
    .select({ wordId: wordFormatting.wordId, isBold: wordFormatting.isBold, isItalic: wordFormatting.isItalic })
    .from(wordFormatting)
    .where(and(eq(wordFormatting.workspaceId, workspaceId), eq(wordFormatting.book, book), eq(wordFormatting.chapter, chapter)));
}

/**
 * Upsert bold/italic formatting for a word.
 * If both isBold and isItalic are false, the record is deleted (reset to no formatting).
 */
export async function setWordFormatting(
  wordId: string,
  isBold: boolean,
  isItalic: boolean,
  textSource: string,
  book: string,
  chapter: number,
  workspaceId: number
): Promise<void> {
  if (!isBold && !isItalic) {
    await userDb.delete(wordFormatting).where(
      and(eq(wordFormatting.workspaceId, workspaceId), eq(wordFormatting.wordId, wordId))
    );
  } else {
    await userDb
      .insert(wordFormatting)
      .values({ wordId, isBold, isItalic, textSource, book, chapter, workspaceId })
      .onConflictDoUpdate({ target: [wordFormatting.workspaceId, wordFormatting.wordId], set: { isBold, isItalic } });
  }
}

/** Returns the highest verse number in a given chapter (used for passage boundary navigation). */
export async function getChapterMaxVerse(
  osisBook: string,
  chapter: number,
  textSource: string
): Promise<number> {
  const book = await getBook(osisBook);
  if (!book) return 0;

  const isLxx = textSource === "STEPBIBLE_LXX";
  const db = isLxx ? (getLxxDb() ?? sourceDb) : sourceDb;
  const tsId = isLxx ? null : (sourceLookups.textSourceByValue[textSource] ?? null);
  const result = await db
    .select({ maxVerse: sql<number>`max(${words.verse})` })
    .from(words)
    .where(
      and(
        eq(words.bookId, book.id),
        eq(words.chapter, chapter),
        ...(tsId != null ? [eq(words.textSourceId, tsId)] : [])
      )
    );
  return result[0]?.maxVerse ?? 0;
}

// ── Line Annotations (chapter-scoped) ─────────────────────────────────────────

/** Returns all line annotations for a chapter, ordered by creation time. */
export async function getChapterLineAnnotations(
  book: string,
  chapter: number,
  textSource: string,
  workspaceId: number
): Promise<LineAnnotation[]> {
  return userDb
    .select()
    .from(lineAnnotations)
    .where(
      and(
        eq(lineAnnotations.workspaceId, workspaceId),
        eq(lineAnnotations.book, book),
        eq(lineAnnotations.chapter, chapter),
        eq(lineAnnotations.textSource, textSource)
      )
    )
    .orderBy(asc(lineAnnotations.createdAt));
}

/** Insert a new line annotation and return the created record. */
export async function createLineAnnotation(
  annotType: string,
  label: string,
  color: string,
  description: string | null,
  outOfSequence: boolean,
  startWordId: string,
  endWordId: string,
  textSource: string,
  book: string,
  chapter: number,
  workspaceId: number
): Promise<LineAnnotation> {
  const [row] = await userDb
    .insert(lineAnnotations)
    .values({ annotType, label, color, description, outOfSequence, startWordId, endWordId, textSource, book, chapter, workspaceId })
    .returning();
  return row;
}

/** Update fields of an existing annotation (label, color, description, outOfSequence, start/end word IDs). */
export async function updateLineAnnotation(
  id: number,
  updates: Partial<Pick<LineAnnotation, "label" | "color" | "description" | "outOfSequence" | "startWordId" | "endWordId">>
): Promise<LineAnnotation> {
  const [row] = await userDb
    .update(lineAnnotations)
    .set(updates)
    .where(eq(lineAnnotations.id, id))
    .returning();
  return row;
}

/** Delete an annotation by id. */
export async function deleteLineAnnotation(id: number): Promise<void> {
  await userDb.delete(lineAnnotations).where(eq(lineAnnotations.id, id));
}

// ── ULT (UnfoldingWord Literal Text) ─────────────────────────────────────────

/**
 * Synchronous — reads base verse text for a chapter from data/ult.db.
 * Returns an empty array if ult.db has not been imported yet.
 */
export function getUltVerses(
  book: string,
  chapter: number
): { verse: number; text: string }[] {
  const db = getUltSqlite();
  if (!db) return [];
  try {
    return db
      .prepare("SELECT verse, text FROM ult_verses WHERE book = ? AND chapter = ? ORDER BY verse")
      .all(book, chapter) as { verse: number; text: string }[];
  } catch {
    return [];
  }
}

/**
 * Returns the ULT Translation record, or null if ULT has not been imported.
 * ULT is workspace-independent so no workspace filter is applied.
 */
export async function getUltTranslation(_workspaceId?: number): Promise<Translation | null> {
  const result = await userDb
    .select()
    .from(translations)
    .where(eq(translations.abbreviation, "ULT"))
    .limit(1);
  return result[0] ?? null;
}

/**
 * Bulk-insert word tag refs, skipping any that conflict on (workspaceId, wordId).
 * This preserves existing manually-assigned tags.
 * Returns the count of rows actually inserted.
 */
export async function bulkInsertWordTagRefs(
  tagId: number,
  refs: Array<{ wordId: string; book: string; chapter: number; textSource: string }>,
  workspaceId: number
): Promise<{ inserted: number }> {
  if (refs.length === 0) return { inserted: 0 };

  // SQLite has a limit of 999 bound parameters; each row uses 5 params.
  const CHUNK = 190;
  let inserted = 0;

  for (let i = 0; i < refs.length; i += CHUNK) {
    const chunk = refs.slice(i, i + CHUNK);
    const result = await userDb
      .insert(wordTagRefs)
      .values(chunk.map((r) => ({ tagId, workspaceId, wordId: r.wordId, book: r.book, chapter: r.chapter, textSource: r.textSource })))
      .onConflictDoNothing()
      .returning({ id: wordTagRefs.id });
    inserted += result.length;
  }

  return { inserted };
}
