import { eq, and, asc, inArray, or, gte, lte, gt, lt, sql, max, like, isNull } from "drizzle-orm";
import { sourceDb, userDb, sourceLookups, lxxLookups, getLxxDb, getLxxSqlite, getUltSqlite, getVcbSqlite, getUserSqlite, getOshbDb, getSblgntDb, getDbAndLookups, getLexiconDbsForLanguage } from "./index";
import { getMtToKjvInstructions } from "@/lib/versification/mt-kjv-mapping";
import type { LookupMaps } from "./index";
import { books, words } from "./source-schema";
import { lexiconEntries } from "./lexica-schema";
import type { Word, WordRow } from "./source-schema";
import { translations, translationVerses, paragraphBreaks, paragraphHeadings, characters, characterRefs, speechSections, wordTags, wordTagRefs, lineIndents, sceneBreaks, passages, rstRelations, wordArrows, wordFormatting, lineAnnotations, bookGroupings, appSettings, translationFootnotes, translationVersions, workspaces, users, textCriticalMarks, notes, intertextualLinks, synopticSets, synopticWordMarks } from "./user-schema";
import type { Book, Translation, TranslationVerse, Character, CharacterRef, SpeechSection, WordTag, WordTagRef, Passage, RstRelation, WordArrow, LineAnnotation, BookGrouping, TranslationFootnote, TranslationVersion, IntertextualLink, SynopticSet, SynopticWordMark } from "./schema";
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
    largeLetters:    row.largeLetters ?? null,
    lemma:           row.lemma,
    strongNumber:    row.strongNumber,
    morphCode:       row.morphCode,
    transliteration: row.transliteration ?? null,
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
    return getOshbDb().select().from(books).where(inArray(books.id, ids)).orderBy(asc(books.bookNumber));
  }
  const { db: srcDb, lookups } = getDbAndLookups(textSource);
  const tsId = lookups.textSourceByValue[textSource];
  if (tsId == null) return [];
  const rows = await srcDb
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
  const { db: srcDb, lookups } = getDbAndLookups(textSource);
  const tsId = lookups.textSourceByValue[textSource];
  if (tsId == null) return book.chapterCount;
  const result = await srcDb
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
  const { db: srcDb, lookups } = getDbAndLookups(textSource);
  const tsId = lookups.textSourceByValue[textSource];
  if (tsId == null) return [];
  const rows = await srcDb
    .select()
    .from(words)
    .where(and(eq(words.bookId, book.id), eq(words.chapter, chapter), eq(words.textSourceId, tsId)))
    .orderBy(asc(words.verse), asc(words.positionInVerse));
  return rows.map((r) => decodeWord(r, lookups));
}

/**
 * Fetch words for a range of chapters from one source.
 * Returns words ordered by (chapter, verse, positionInVerse).
 * Chapters that yield no words are simply absent from the result.
 */
export async function getChapterWordsRange(
  osisBook: string,
  chapters: number[],
  textSource: TextSource
): Promise<Word[]> {
  if (chapters.length === 0) return [];
  if (chapters.length === 1) return getChapterWords(osisBook, chapters[0], textSource);

  const book = await getBook(osisBook);
  if (!book) return [];

  const chMin = Math.min(...chapters);
  const chMax = Math.max(...chapters);

  if (textSource === "STEPBIBLE_LXX") {
    const lxxDb = getLxxDb();
    if (!lxxDb) return [];
    const rows = await lxxDb
      .select()
      .from(words)
      .where(and(
        eq(words.bookId, book.id),
        gte(words.chapter, chMin),
        lte(words.chapter, chMax),
      ))
      .orderBy(asc(words.chapter), asc(words.verse), asc(words.positionInVerse));
    return rows.map((r) => decodeWord(r, lxxLookups));
  }

  const { db: srcDb, lookups } = getDbAndLookups(textSource);
  const tsId = lookups.textSourceByValue[textSource];
  if (tsId == null) return [];
  const rows = await srcDb
    .select()
    .from(words)
    .where(and(
      eq(words.bookId, book.id),
      gte(words.chapter, chMin),
      lte(words.chapter, chMax),
      eq(words.textSourceId, tsId),
    ))
    .orderBy(asc(words.chapter), asc(words.verse), asc(words.positionInVerse));
  return rows.map((r) => decodeWord(r, lookups));
}

// ── Vocabulary List Creator ────────────────────────────────────────────────

export interface ScopeWordRow {
  key: string;              // strongNumber (OSHB) or lemma (SBLGNT/STEPBIBLE_LXX) — the grouping key
  lemma: string | null;
  strongNumber: string | null;
  partOfSpeech: string | null;
}

/**
 * Returns the set of distinct words occurring within a scope of one or more
 * books (optionally restricted to a chapter range — only meaningful when
 * osisBooks.length === 1). Grouping key is strongNumber for Hebrew (OSHB),
 * lemma for Greek (SBLGNT/STEPBIBLE_LXX), matching getCorpusWideWordCounts'
 * grouping so the two can be joined by `key`.
 */
export async function getDistinctWordsInScope(
  osisBooks: string[],
  chapterRange: { start: number; end: number } | null,
  textSource: TextSource,
): Promise<ScopeWordRow[]> {
  if (osisBooks.length === 0) return [];

  const bookRows = await sourceDb
    .select({ id: books.id })
    .from(books)
    .where(inArray(books.osisCode, osisBooks));
  if (bookRows.length === 0) return [];
  const bookIds = bookRows.map((b) => b.id);

  const isLxx = textSource === "STEPBIBLE_LXX";
  const { db, lookups } = isLxx
    ? { db: getLxxDb() ?? getOshbDb(), lookups: lxxLookups }
    : getDbAndLookups(textSource);

  const conditions = [inArray(words.bookId, bookIds)];
  if (!isLxx) {
    const tsId = lookups.textSourceByValue[textSource];
    if (tsId == null) return [];
    conditions.push(eq(words.textSourceId, tsId));
  }
  if (chapterRange) {
    conditions.push(gte(words.chapter, chapterRange.start), lte(words.chapter, chapterRange.end));
  }

  const groupCol = textSource === "OSHB" ? words.strongNumber : words.lemma;
  const rows = await db
    .select({
      key:            groupCol,
      lemma:          words.lemma,
      strongNumber:   words.strongNumber,
      partOfSpeechId: words.partOfSpeechId,
    })
    .from(words)
    .where(and(...conditions));

  const seen = new Map<string, ScopeWordRow>();
  for (const r of rows) {
    if (!r.key || seen.has(r.key)) continue;
    seen.set(r.key, {
      key:          r.key,
      lemma:        r.lemma,
      strongNumber: r.strongNumber,
      partOfSpeech: r.partOfSpeechId != null ? (lookups.partOfSpeechById[r.partOfSpeechId] ?? null) : null,
    });
  }
  return [...seen.values()];
}

// Module-level cache of corpus-wide word counts, keyed by textSource. Lazily
// populated on first call — a full-table GROUP BY is cheap once, but not
// worth paying at app startup for users who never open the vocabulary tool.
const corpusWordCountCache = new Map<TextSource, Map<string, number>>();

/**
 * Returns corpus-wide occurrence counts for every distinct word in the given
 * corpus, grouped by strongNumber (OSHB) or lemma (SBLGNT/STEPBIBLE_LXX).
 * Cached in memory after first call since the underlying DBs are read-only
 * and don't change at runtime.
 */
export async function getCorpusWideWordCounts(textSource: TextSource): Promise<Map<string, number>> {
  const cached = corpusWordCountCache.get(textSource);
  if (cached) return cached;

  const isLxx = textSource === "STEPBIBLE_LXX";
  const { db, lookups } = isLxx
    ? { db: getLxxDb() ?? getOshbDb(), lookups: lxxLookups }
    : getDbAndLookups(textSource);

  let whereClause;
  if (!isLxx) {
    const tsId = lookups.textSourceByValue[textSource];
    if (tsId == null) { corpusWordCountCache.set(textSource, new Map()); return new Map(); }
    whereClause = eq(words.textSourceId, tsId);
  }

  const groupCol = textSource === "OSHB" ? words.strongNumber : words.lemma;
  const rows = await db
    .select({ key: groupCol, n: sql<number>`count(*)` })
    .from(words)
    .where(whereClause)
    .groupBy(groupCol);

  const result = new Map<string, number>();
  for (const r of rows) if (r.key) result.set(r.key, r.n);
  corpusWordCountCache.set(textSource, result);
  return result;
}

export interface LexiconGloss {
  lemma: string | null;
  shortGloss: string | null;
  definition: string | null;
  source: string;
}

/**
 * Bulk lexicon lookup for a set of keys (strongNumber for Hebrew, lemma for
 * Greek) across all per-language lexicon DBs, fanning out in the same
 * source-priority order as app/api/lexicon/route.ts but batched via
 * inArray() rather than one request per word.
 */
export async function getBulkLexiconGlosses(
  keys: string[],
  language: "hebrew" | "greek",
  keyType: "strongNumber" | "lemma",
): Promise<Map<string, LexiconGloss>> {
  const result = new Map<string, LexiconGloss>();
  if (keys.length === 0) return result;
  const remaining = new Set(keys);
  const CHUNK = 900; // stay under SQLite's default bound-parameter limit

  for (const { db, source } of getLexiconDbsForLanguage(language)) {
    if (remaining.size === 0) break;
    const col = keyType === "strongNumber" ? lexiconEntries.strongNumber : lexiconEntries.lemma;
    const remainingArr = [...remaining];
    for (let i = 0; i < remainingArr.length; i += CHUNK) {
      const chunk = remainingArr.slice(i, i + CHUNK);
      const rows = await db
        .select({ key: col, lemma: lexiconEntries.lemma, shortGloss: lexiconEntries.shortGloss, definition: lexiconEntries.definition })
        .from(lexiconEntries)
        .where(inArray(col, chunk));
      for (const r of rows) {
        if (!r.key || result.has(r.key)) continue;
        result.set(r.key, { lemma: r.lemma, shortGloss: r.shortGloss, definition: r.definition, source });
        remaining.delete(r.key);
      }
    }
  }
  return result;
}

export async function getWordById(wordId: string): Promise<Word | undefined> {
  if (wordId.startsWith("LXX.")) {
    const lxxDb = getLxxDb();
    if (!lxxDb) return undefined;
    const results = await lxxDb.select().from(words).where(eq(words.wordId, wordId)).limit(1);
    return results[0] ? decodeWord(results[0], lxxLookups) : undefined;
  }
  const db = wordId.startsWith("SBLGNT.") ? getSblgntDb() : getOshbDb();
  const lookups = wordId.startsWith("SBLGNT.") ? getDbAndLookups("SBLGNT").lookups : getDbAndLookups("OSHB").lookups;
  const results = await db.select().from(words).where(eq(words.wordId, wordId)).limit(1);
  return results[0] ? decodeWord(results[0], lookups) : undefined;
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
  const instructions = getMtToKjvInstructions(osisBook, chapter);

  // Only apply cross-chapter remapping for Jonah/Joel/Malachi — same logic as
  // getTranslationVerses.  Psalm superscription offsets are same-chapter so the
  // simple prefix query already covers them.
  const hasCrossChapterRemap = instructions?.some(i => i.kjvChapter !== chapter);

  let translationIds: number[];

  if (!hasCrossChapterRemap) {
    // Simple case: match by osis_ref prefix (e.g. "1Sam.1.") — avoids
    // dependency on book_id which may differ across database versions.
    const prefix = `${osisBook}.${chapter}.`;
    const rows = await userDb
      .selectDistinct({ translationId: translationVerses.translationId })
      .from(translationVerses)
      .where(like(translationVerses.osisRef, `${prefix}%`));
    translationIds = rows.map((r) => r.translationId);
  } else {
    // Cross-chapter remap (e.g. MT Jonah 2 spans KJV Jonah 1:17 + Jonah 2:1-10).
    // A translation "has" this chapter if it has at least one verse in any of
    // the remapped KJV chapter/verse ranges.
    const conditions = instructions!.map((instr) => {
      const prefix = `${osisBook}.${instr.kjvChapter}.`;
      const verseEnd = instr.kjvVerseEnd === 999 ? 999_999 : instr.kjvVerseEnd;
      return and(
        like(translationVerses.osisRef, `${prefix}%`),
        gte(translationVerses.verse, instr.kjvVerseStart),
        lte(translationVerses.verse, verseEnd),
      );
    });
    const rows = await userDb
      .selectDistinct({ translationId: translationVerses.translationId })
      .from(translationVerses)
      .where(or(...conditions));
    translationIds = rows.map((r) => r.translationId);
  }

  if (translationIds.length === 0) return [];

  return userDb
    .select()
    .from(translations)
    .where(inArray(translations.id, translationIds))
    .orderBy(asc(translations.abbreviation));
}

/** Returns all translation verses for a full book (used for USFM export). */
export async function getBookTranslationVerses(
  translationId: number,
  osisBook: string,
): Promise<TranslationVerse[]> {
  return userDb
    .select()
    .from(translationVerses)
    .where(
      and(
        eq(translationVerses.translationId, translationId),
        like(translationVerses.osisRef, `${osisBook}.%`)
      )
    )
    .orderBy(asc(translationVerses.chapter), asc(translationVerses.verse));
}

export async function getTranslationVerses(
  translationId: number,
  osisBook: string,
  chapter: number,
  _workspaceId?: number
): Promise<TranslationVerse[]> {
  const instructions = getMtToKjvInstructions(osisBook, chapter);

  // Only apply remapping when cross-chapter instructions exist (Jonah, Joel, Malachi).
  // Same-chapter Psalm superscription offsets are intentionally excluded — user-imported
  // translations store their own verse numbering and shouldn't be silently re-numbered.
  const hasCrossChapterRemap = instructions?.some(i => i.kjvChapter !== chapter);

  if (!hasCrossChapterRemap) {
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

  // Cross-chapter remapping (e.g. MT Jonah 2 fetches KJV Jonah 1:17 + Jonah 2:1-10).
  // The returned `.verse` values are remapped to MT verse numbers.
  const allResults: TranslationVerse[] = [];
  for (const instr of instructions!) {
    const prefix = `${osisBook}.${instr.kjvChapter}.`;
    const verseEnd = instr.kjvVerseEnd === 999 ? 999_999 : instr.kjvVerseEnd;
    const rows = await userDb
      .select()
      .from(translationVerses)
      .where(
        and(
          eq(translationVerses.translationId, translationId),
          like(translationVerses.osisRef, `${prefix}%`),
          gte(translationVerses.verse, instr.kjvVerseStart),
          lte(translationVerses.verse, verseEnd)
        )
      );
    for (const row of rows) {
      allResults.push({ ...row, verse: row.verse + instr.mtVerseOffset });
    }
  }
  return allResults.sort((a, b) => a.verse - b.verse);
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
): Promise<{ wordId: string; heading: string | null; level: number; verse: number; outOfSequence: boolean; extendedThrough: number | null; thematic: boolean; thematicLetter: string | null; transitional: boolean }[]> {
  const rows = await userDb
    .select({
      wordId:          sceneBreaks.wordId,
      heading:         sceneBreaks.heading,
      level:           sceneBreaks.level,
      verse:           sceneBreaks.verse,
      outOfSequence:   sceneBreaks.outOfSequence,
      extendedThrough: sceneBreaks.extendedThrough,
      thematic:        sceneBreaks.thematic,
      thematicLetter:  sceneBreaks.thematicLetter,
      transitional:    sceneBreaks.transitional,
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
): Promise<{ wordId: string; heading: string | null; level: number; chapter: number; verse: number; positionInVerse: number; outOfSequence: boolean; extendedThrough: number | null; thematic: boolean; thematicLetter: string | null; transitional: boolean }[]> {
  const rows = await userDb
    .select({
      wordId:          sceneBreaks.wordId,
      heading:         sceneBreaks.heading,
      level:           sceneBreaks.level,
      chapter:         sceneBreaks.chapter,
      verse:           sceneBreaks.verse,
      outOfSequence:   sceneBreaks.outOfSequence,
      extendedThrough: sceneBreaks.extendedThrough,
      thematic:        sceneBreaks.thematic,
      thematicLetter:  sceneBreaks.thematicLetter,
      transitional:    sceneBreaks.transitional,
    })
    .from(sceneBreaks)
    .where(and(eq(sceneBreaks.workspaceId, workspaceId), eq(sceneBreaks.book, book), eq(sceneBreaks.textSource, textSource)))
    .orderBy(asc(sceneBreaks.chapter), asc(sceneBreaks.verse), asc(sceneBreaks.level));
  if (rows.length === 0) return [];
  const wordIds = rows.map((r) => r.wordId);
  const db = textSource === "STEPBIBLE_LXX" ? (getLxxDb() ?? getOshbDb()) : getDbAndLookups(textSource).db;
  const posRows = await db
    .select({ wordId: words.wordId, positionInVerse: words.positionInVerse })
    .from(words)
    .where(inArray(words.wordId, wordIds));
  const posMap = new Map(posRows.map((r) => [r.wordId, r.positionInVerse]));
  return rows.map((r) => ({ ...r, positionInVerse: posMap.get(r.wordId) ?? 1 }));
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
  const { db: _srcDb, lookups: _srcLookups } = textSource === "STEPBIBLE_LXX"
    ? { db: getLxxDb() ?? getOshbDb(), lookups: lxxLookups }
    : getDbAndLookups(textSource);
  const db = _srcDb;
  const tsId = textSource === "STEPBIBLE_LXX" ? null : (_srcLookups.textSourceByValue[textSource] ?? null);
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

/** Sets or clears the transitional (janus) flag for a specific (wordId, level) section break. */
export async function updateSceneBreakTransitional(
  wordId: string,
  level: number,
  transitional: boolean,
  workspaceId: number
): Promise<void> {
  await userDb
    .update(sceneBreaks)
    .set({ transitional })
    .where(and(eq(sceneBreaks.workspaceId, workspaceId), eq(sceneBreaks.wordId, wordId), eq(sceneBreaks.level, level)));
}

/** Sets or clears the thematic flag and letter for a specific (wordId, level) section break. */
export async function updateSceneBreakThematic(
  wordId: string,
  level: number,
  thematic: boolean,
  thematicLetter: string | null,
  workspaceId: number
): Promise<void> {
  await userDb
    .update(sceneBreaks)
    .set({ thematic, thematicLetter: thematic ? thematicLetter : null })
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
    const { db: _pDb, lookups: _pLookups } = isLxx
      ? { db: getLxxDb() ?? getOshbDb(), lookups: lxxLookups }
      : getDbAndLookups(passage.textSource);
    const db = _pDb;
    const tsId = isLxx ? null : (_pLookups.textSourceByValue[passage.textSource] ?? null);
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

export async function getCharacters(books: string | string[], workspaceId: number): Promise<Character[]> {
  const bookList = Array.isArray(books) ? books : [books];
  const bookFilter = bookList.length === 1
    ? eq(characters.book, bookList[0])
    : inArray(characters.book, bookList);
  return userDb
    .select()
    .from(characters)
    .where(and(eq(characters.workspaceId, workspaceId), bookFilter))
    .orderBy(asc(characters.sortOrder), asc(characters.id));
}

export async function reorderCharacters(items: { id: number; sortOrder: number }[]): Promise<void> {
  for (const { id, sortOrder } of items) {
    await userDb.update(characters).set({ sortOrder }).where(eq(characters.id, id));
  }
}

export async function createCharacter(
  name: string,
  color: string,
  book: string,
  workspaceId: number,
  lemmas?: string[] | null,
  corpus?: WordTagCorpusInput,
): Promise<Character> {
  const result = await userDb.insert(characters).values({
    name, color, book, workspaceId,
    corpusGroupingId: corpus?.corpusGroupingId ?? null,
    corpusType: corpus?.corpusType ?? "book",
    corpusChapter: corpus?.corpusChapter ?? null,
    corpusPassageId: corpus?.corpusPassageId ?? null,
    lemmas: lemmas?.length ? JSON.stringify(lemmas) : null,
  }).returning();
  return result[0];
}

export async function deleteCharacter(id: number): Promise<void> {
  await userDb.delete(characters).where(eq(characters.id, id));
}

export async function updateCharacter(
  id: number,
  name: string,
  color: string,
  lemmas?: string[] | null,
  corpus?: WordTagCorpusInput,
): Promise<Character> {
  const setData: Record<string, unknown> = { name, color };
  if (lemmas !== undefined) setData.lemmas = lemmas?.length ? JSON.stringify(lemmas) : null;
  if (corpus) {
    if (corpus.corpusType !== undefined) setData.corpusType = corpus.corpusType;
    if (corpus.corpusGroupingId !== undefined) setData.corpusGroupingId = corpus.corpusGroupingId;
    if (corpus.corpusChapter !== undefined) setData.corpusChapter = corpus.corpusChapter;
    if (corpus.corpusPassageId !== undefined) setData.corpusPassageId = corpus.corpusPassageId;
  }
  const result = await userDb
    .update(characters)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .set(setData as any)
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

/**
 * Clears a character out of every ref that references it — deleting the row
 * when it's the primary (character1Id) assignment, or just unsetting the
 * secondary slot (character2Id) so the other character's assignment survives.
 * Mirrors the character_refs FK's own onDelete rules (cascade / set null),
 * so this is safe to call before a lemma-driven bulk re-link (see
 * bulkInsertCharacterRefs) without disturbing unrelated manual assignments.
 */
export async function deleteCharacterRefsByCharacterId(characterId: number): Promise<void> {
  await userDb.delete(characterRefs).where(eq(characterRefs.character1Id, characterId));
  await userDb.update(characterRefs).set({ character2Id: null }).where(eq(characterRefs.character2Id, characterId));
}

/**
 * Bulk-insert character refs (as the primary/character1Id assignment),
 * skipping any word that already has a ref at all — this preserves existing
 * manually-assigned characters (including any secondary character2Id).
 * Returns the count of rows actually inserted.
 */
export async function bulkInsertCharacterRefs(
  characterId: number,
  refs: Array<{ wordId: string; book: string; chapter: number; textSource: string }>,
  workspaceId: number
): Promise<{ inserted: number }> {
  if (refs.length === 0) return { inserted: 0 };

  // SQLite has a limit of 999 bound parameters; each row uses 7 params.
  const CHUNK = 140;
  let inserted = 0;

  for (let i = 0; i < refs.length; i += CHUNK) {
    const chunk = refs.slice(i, i + CHUNK);
    const result = await userDb
      .insert(characterRefs)
      .values(chunk.map((r) => ({
        character1Id: characterId, character2Id: null, workspaceId,
        wordId: r.wordId, book: r.book, chapter: r.chapter, textSource: r.textSource,
      })))
      .onConflictDoNothing()
      .returning({ id: characterRefs.id });
    inserted += result.length;
  }

  return { inserted };
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

export async function getWordTags(books: string | string[], workspaceId: number): Promise<WordTag[]> {
  const bookList = Array.isArray(books) ? books : [books];
  const bookFilter = bookList.length === 1
    ? eq(wordTags.book, bookList[0])
    : inArray(wordTags.book, bookList);
  return userDb
    .select()
    .from(wordTags)
    .where(and(eq(wordTags.workspaceId, workspaceId), bookFilter))
    .orderBy(asc(wordTags.sortOrder), asc(wordTags.id));
}

export async function reorderWordTags(items: { id: number; sortOrder: number }[]): Promise<void> {
  for (const { id, sortOrder } of items) {
    await userDb.update(wordTags).set({ sortOrder }).where(eq(wordTags.id, id));
  }
}

export interface WordTagCorpusInput {
  corpusType?: string;
  corpusGroupingId?: number | null;
  corpusChapter?: number | null;
  corpusPassageId?: number | null;
}

export async function createWordTag(
  name: string,
  color: string,
  type: string,
  book: string,
  workspaceId: number,
  corpusGroupingId?: number | null,
  lemmas?: string[] | null,
  corpus?: WordTagCorpusInput,
): Promise<WordTag> {
  const result = await userDb.insert(wordTags).values({
    name, color, type, book, workspaceId,
    corpusGroupingId: corpus?.corpusGroupingId ?? corpusGroupingId ?? null,
    corpusType: corpus?.corpusType ?? "book",
    corpusChapter: corpus?.corpusChapter ?? null,
    corpusPassageId: corpus?.corpusPassageId ?? null,
    lemmas: lemmas?.length ? JSON.stringify(lemmas) : null,
  }).returning();
  return result[0];
}

export async function updateWordTag(
  id: number,
  name: string,
  color: string,
  corpusGroupingId?: number | null,
  lemmas?: string[] | null,
  corpus?: WordTagCorpusInput,
): Promise<WordTag> {
  const setData: Record<string, unknown> = { name, color };
  if (corpusGroupingId !== undefined) setData.corpusGroupingId = corpusGroupingId;
  if (lemmas !== undefined) setData.lemmas = lemmas?.length ? JSON.stringify(lemmas) : null;
  if (corpus) {
    if (corpus.corpusType !== undefined) setData.corpusType = corpus.corpusType;
    if (corpus.corpusGroupingId !== undefined) setData.corpusGroupingId = corpus.corpusGroupingId;
    if (corpus.corpusChapter !== undefined) setData.corpusChapter = corpus.corpusChapter;
    if (corpus.corpusPassageId !== undefined) setData.corpusPassageId = corpus.corpusPassageId;
  }
  const result = await userDb
    .update(wordTags)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .set(setData as any)
    .where(eq(wordTags.id, id))
    .returning();
  return result[0];
}

export async function deleteWordTag(id: number): Promise<void> {
  await userDb.delete(wordTags).where(eq(wordTags.id, id));
}

export async function setWordTagHighlighted(id: number, highlighted: boolean): Promise<WordTag> {
  const result = await userDb
    .update(wordTags)
    .set({ highlighted })
    .where(eq(wordTags.id, id))
    .returning();
  return result[0];
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

export async function deleteWordTagRefsByTagId(tagId: number): Promise<void> {
  await userDb.delete(wordTagRefs).where(eq(wordTagRefs.tagId, tagId));
}

function stripHebVowels(s: string): string {
  return s.replace(/[֑-ׇ]/g, "");
}

function isConsonantalHebrew(s: string): boolean {
  return /[א-ת]/.test(s) && !/[ְ-ׇ]/.test(s);
}

/** For a consonantal Hebrew string (e.g. "אמר"), return all matching Strong's
 *  numbers from the Hebrew lexicon (e.g. ["H559","H560",…]). */
async function resolveConsonantalToStrongs(consonantal: string): Promise<string[]> {
  const hebrewDbs = getLexiconDbsForLanguage("hebrew");
  if (hebrewDbs.length === 0) return [];
  // Use an expanded LIKE to narrow the DB scan before JS filtering
  const expandedPattern = consonantal.split("").join("%");
  const seen = new Set<string>();
  for (const { db } of hebrewDbs) {
    const rows = await db
      .select({ strongNumber: lexiconEntries.strongNumber, lemma: lexiconEntries.lemma })
      .from(lexiconEntries)
      .where(and(eq(lexiconEntries.language, "hebrew"), like(lexiconEntries.lemma, `${expandedPattern}%`)));
    for (const row of rows) {
      if (row.strongNumber && row.lemma && stripHebVowels(row.lemma) === consonantal) {
        seen.add(row.strongNumber);
      }
    }
  }
  return [...seen];
}

/** Search for words by a list of lemma strings (supports Strong's H/G numbers)
 *  within a given set of corpus books and text source.
 *  Returns lightweight refs suitable for bulk word-tag-ref insertion. */
export async function getWordRefsByLemmas(
  lemmas: string[],
  corpusBooks: string[],
  textSourceName: string,
): Promise<Array<{ wordId: string; book: string; chapter: number; textSource: string }>> {
  if (lemmas.length === 0 || corpusBooks.length === 0) return [];

  const isLxx = textSourceName === "STEPBIBLE_LXX" || textSourceName === "LXX";

  // Resolve consonantal Hebrew lemmas (e.g. "אמר") to Strong's numbers before searching
  const resolvedLemmas: string[] = [];
  for (const q of lemmas) {
    if (!isLxx && isConsonantalHebrew(q)) {
      const strongs = await resolveConsonantalToStrongs(q);
      if (strongs.length > 0) resolvedLemmas.push(...strongs);
      else resolvedLemmas.push(q);
    } else {
      resolvedLemmas.push(q);
    }
  }
  const dedupedLemmas = [...new Set(resolvedLemmas)];

  function buildLemmaConditions(lemmaList: string[]) {
    return lemmaList.map((q) => {
      if (/^[HG]\d+[a-z]?$/.test(q)) return eq(words.strongNumber, q);
      return like(words.lemma, `%${q}%`);
    });
  }

  const refs: Array<{ wordId: string; book: string; chapter: number; textSource: string }> = [];

  if (isLxx) {
    const lxxDb = getLxxDb();
    if (!lxxDb) return refs;
    const bookCond = corpusBooks.length === 1
      ? eq(books.osisCode, corpusBooks[0])
      : inArray(books.osisCode, corpusBooks);
    const lemmaConds = buildLemmaConditions(dedupedLemmas);
    const rows = await lxxDb
      .select({ wordId: words.wordId, osisCode: books.osisCode, chapter: words.chapter })
      .from(words)
      .innerJoin(books, eq(words.bookId, books.id))
      .where(and(bookCond, lemmaConds.length === 1 ? lemmaConds[0] : or(...lemmaConds)));
    for (const r of rows) refs.push({ wordId: r.wordId, book: r.osisCode, chapter: r.chapter, textSource: "STEPBIBLE_LXX" });
  } else {
    const bookCond = corpusBooks.length === 1
      ? eq(books.osisCode, corpusBooks[0])
      : inArray(books.osisCode, corpusBooks);
    const lemmaConds = buildLemmaConditions(dedupedLemmas);
    const { db: _lemmaDb, lookups: _lemmaLookups } = getDbAndLookups(textSourceName);
    const rows = await _lemmaDb
      .select({ wordId: words.wordId, osisCode: books.osisCode, chapter: words.chapter, textSourceId: words.textSourceId })
      .from(words)
      .innerJoin(books, eq(words.bookId, books.id))
      .where(and(bookCond, lemmaConds.length === 1 ? lemmaConds[0] : or(...lemmaConds)));
    for (const r of rows) {
      const ts = _lemmaLookups.textSourceById[r.textSourceId] ?? textSourceName;
      refs.push({ wordId: r.wordId, book: r.osisCode, chapter: r.chapter, textSource: ts });
    }
  }

  return refs;
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
  books: string | string[],
  textSource: string,
  workspaceId: number
): Promise<Passage[]> {
  const bookList = Array.isArray(books) ? books : [books];
  const bookFilter = bookList.length === 1
    ? eq(passages.book, bookList[0])
    : inArray(passages.book, bookList);
  return userDb
    .select()
    .from(passages)
    .where(and(eq(passages.workspaceId, workspaceId), bookFilter, eq(passages.textSource, textSource)))
    .orderBy(asc(passages.startChapter), asc(passages.startVerse));
}

export async function getLabeledPassages(workspaceId: number): Promise<Passage[]> {
  return userDb
    .select()
    .from(passages)
    .where(and(
      eq(passages.workspaceId, workspaceId),
      sql`trim(${passages.label}) != ''`,
      // Synoptic-set columns carry a non-empty label too but belong on the
      // /synoptic index, not the general "My Passages" list — see synopticSets.
      isNull(passages.synopticSetId)
    ))
    .orderBy(asc(passages.book), asc(passages.startChapter), asc(passages.startVerse));
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
  endBook: string | null,
  endChapter: number,
  endVerse: number,
  workspaceId: number
): Promise<Passage> {
  const result = await userDb
    .insert(passages)
    .values({
      book, textSource, label,
      startChapter, startVerse,
      endBook: endBook && endBook !== book ? endBook : null,
      endChapter, endVerse,
      workspaceId,
    })
    .returning();
  return result[0];
}

export async function updatePassage(
  id: number,
  updates: Partial<Pick<Passage, "label" | "startChapter" | "startVerse" | "endBook" | "endChapter" | "endVerse">>
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
 * Fetch all words in a passage range. Handles single-chapter, multi-chapter,
 * and cross-book passages (e.g. 1 Sam → 2 Sam).
 *
 * @param osisBook   Start book OSIS code
 * @param endOsisBook  End book OSIS code — null/undefined means same as osisBook
 */
export async function getPassageWords(
  osisBook: string,
  textSource: string,
  startChapter: number,
  startVerse: number,
  endChapter: number,
  endVerse: number,
  endOsisBook?: string | null
): Promise<Word[]> {
  const effectiveEndBook = (endOsisBook && endOsisBook !== osisBook) ? endOsisBook : osisBook;
  const isCrossBook = effectiveEndBook !== osisBook;

  const isLxx = textSource === "STEPBIBLE_LXX";
  const { db: _passageDb, lookups: _passageLookups } = isLxx
    ? { db: getLxxDb() ?? getOshbDb(), lookups: lxxLookups }
    : getDbAndLookups(textSource);
  const db = _passageDb;
  const maps = _passageLookups;
  const tsId = isLxx ? null : (_passageLookups.textSourceByValue[textSource] ?? null);

  /** Build the chapter/verse filter for a single-book segment. */
  function buildRangeFilter(
    sc: number, sv: number, ec: number, ev: number,
    openEnd: boolean,  // true = all chapters from sc:sv onwards (no upper chapter bound)
    openStart: boolean // true = all chapters up to ec:ev (no lower chapter bound)
  ) {
    if (openEnd) {
      return or(
        and(eq(words.chapter, sc), gte(words.verse, sv)),
        gt(words.chapter, sc)
      );
    }
    if (openStart) {
      return or(
        lt(words.chapter, ec),
        and(eq(words.chapter, ec), lte(words.verse, ev))
      );
    }
    if (sc === ec) {
      return and(eq(words.chapter, sc), gte(words.verse, sv), lte(words.verse, ev));
    }
    return or(
      and(eq(words.chapter, sc), gte(words.verse, sv)),
      and(gt(words.chapter, sc), lt(words.chapter, ec)),
      and(eq(words.chapter, ec), lte(words.verse, ev))
    );
  }

  if (!isCrossBook) {
    const book = await getBook(osisBook);
    if (!book) return [];
    const baseFilter = tsId != null
      ? and(eq(words.bookId, book.id), eq(words.textSourceId, tsId))
      : eq(words.bookId, book.id);
    const rangeFilter = buildRangeFilter(startChapter, startVerse, endChapter, endVerse, false, false);
    const rows = await db
      .select().from(words)
      .where(and(baseFilter, rangeFilter))
      .orderBy(asc(words.chapter), asc(words.verse), asc(words.positionInVerse));
    return rows.map((r) => decodeWord(r, maps));
  }

  // Cross-book: fetch start book (startChapter:startVerse → end of book) and
  // end book (chapter 1:1 → endChapter:endVerse) then concatenate.
  const [startBookRecord, endBookRecord] = await Promise.all([
    getBook(osisBook),
    getBook(effectiveEndBook),
  ]);
  if (!startBookRecord || !endBookRecord) return [];

  const startBaseFilter = tsId != null
    ? and(eq(words.bookId, startBookRecord.id), eq(words.textSourceId, tsId))
    : eq(words.bookId, startBookRecord.id);
  const endBaseFilter = tsId != null
    ? and(eq(words.bookId, endBookRecord.id), eq(words.textSourceId, tsId))
    : eq(words.bookId, endBookRecord.id);

  const [startRows, endRows] = await Promise.all([
    db.select().from(words)
      .where(and(startBaseFilter, buildRangeFilter(startChapter, startVerse, 0, 0, true, false)))
      .orderBy(asc(words.chapter), asc(words.verse), asc(words.positionInVerse)),
    db.select().from(words)
      .where(and(endBaseFilter, buildRangeFilter(0, 0, endChapter, endVerse, false, true)))
      .orderBy(asc(words.chapter), asc(words.verse), asc(words.positionInVerse)),
  ]);

  return [
    ...startRows.map((r) => decodeWord(r, maps)),
    ...endRows.map((r) => decodeWord(r, maps)),
  ];
}

// ── Synoptic Sets ─────────────────────────────────────────────────────────────

export interface SynopticSetWithColumns extends SynopticSet {
  columns: Passage[];
}

export interface SynopticSetColumnInput {
  book: string;
  textSource: string;
  columnLabel: string;
  startChapter: number;
  startVerse: number;
  endBook?: string | null;
  endChapter: number;
  endVerse: number;
}

export async function getSynopticSets(workspaceId: number): Promise<SynopticSetWithColumns[]> {
  const sets = await userDb
    .select()
    .from(synopticSets)
    .where(eq(synopticSets.workspaceId, workspaceId))
    .orderBy(asc(synopticSets.corpus), asc(synopticSets.sortOrder), asc(synopticSets.id));

  if (sets.length === 0) return [];

  const setIds = sets.map((s) => s.id);
  const allColumns = await userDb
    .select()
    .from(passages)
    .where(and(eq(passages.workspaceId, workspaceId), inArray(passages.synopticSetId, setIds)))
    .orderBy(asc(passages.columnIndex));

  const columnsBySetId = new Map<number, Passage[]>();
  for (const col of allColumns) {
    if (col.synopticSetId == null) continue;
    if (!columnsBySetId.has(col.synopticSetId)) columnsBySetId.set(col.synopticSetId, []);
    columnsBySetId.get(col.synopticSetId)!.push(col);
  }

  return sets.map((s) => ({ ...s, columns: columnsBySetId.get(s.id) ?? [] }));
}

export async function getSynopticSet(id: number, workspaceId: number): Promise<SynopticSetWithColumns | undefined> {
  const results = await userDb
    .select()
    .from(synopticSets)
    .where(and(eq(synopticSets.id, id), eq(synopticSets.workspaceId, workspaceId)))
    .limit(1);
  const set = results[0];
  if (!set) return undefined;

  const columns = await userDb
    .select()
    .from(passages)
    .where(eq(passages.synopticSetId, id))
    .orderBy(asc(passages.columnIndex));

  return { ...set, columns };
}

async function insertSynopticSetColumns(
  setId: number,
  columns: SynopticSetColumnInput[],
  workspaceId: number
): Promise<Passage[]> {
  if (columns.length === 0) return [];
  const rows = columns.map((col, index) => ({
    book: col.book,
    textSource: col.textSource,
    label: col.columnLabel,
    startChapter: col.startChapter,
    startVerse: col.startVerse,
    endBook: col.endBook && col.endBook !== col.book ? col.endBook : null,
    endChapter: col.endChapter,
    endVerse: col.endVerse,
    workspaceId,
    synopticSetId: setId,
    columnIndex: index,
    columnLabel: col.columnLabel,
  }));
  return userDb.insert(passages).values(rows).returning();
}

export async function createSynopticSet(
  title: string,
  corpus: string,
  source: string,
  slug: string | null,
  columns: SynopticSetColumnInput[],
  workspaceId: number
): Promise<SynopticSetWithColumns> {
  const [set] = await userDb
    .insert(synopticSets)
    .values({ title, corpus, source, slug, workspaceId })
    .returning();

  const insertedColumns = await insertSynopticSetColumns(set.id, columns, workspaceId);
  return { ...set, columns: insertedColumns };
}

/**
 * Replace every column of a synoptic set in one shot — simplest correct way to
 * handle add/remove/reorder/rebook of columns without a diffing algorithm.
 * Underlying editing data (line annotations, paragraph breaks, etc.) lives on
 * book/chapter/textSource, independent of the passages row, so it's untouched.
 */
export async function replaceSynopticSetColumns(
  setId: number,
  columns: SynopticSetColumnInput[],
  workspaceId: number
): Promise<Passage[]> {
  await userDb.delete(passages).where(and(eq(passages.synopticSetId, setId), eq(passages.workspaceId, workspaceId)));
  return insertSynopticSetColumns(setId, columns, workspaceId);
}

export async function updateSynopticSetMeta(
  id: number,
  updates: Partial<Pick<SynopticSet, "title" | "corpus" | "sortOrder">>,
  workspaceId: number
): Promise<SynopticSet> {
  const [row] = await userDb
    .update(synopticSets)
    .set(updates)
    .where(and(eq(synopticSets.id, id), eq(synopticSets.workspaceId, workspaceId)))
    .returning();
  return row;
}

export async function deleteSynopticSet(id: number, workspaceId: number): Promise<void> {
  await userDb.delete(synopticSets).where(and(eq(synopticSets.id, id), eq(synopticSets.workspaceId, workspaceId)));
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

export async function updateRstRelationIntersectPoint(
  id: number,
  intersectPoint: "start" | "mid" | "end",
): Promise<void> {
  await userDb
    .update(rstRelations)
    .set({ intersectPoint })
    .where(eq(rstRelations.id, id));
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

export async function updateWordArrow(
  id: number,
  patch: {
    color?: string | null;
    midpointDx?: number | null;
    midpointDy?: number | null;
    midpoint2Dx?: number | null;
    midpoint2Dy?: number | null;
    fromWordId?: string;
    toWordId?: string;
  }
): Promise<WordArrow> {
  const [row] = await userDb
    .update(wordArrows)
    .set(patch)
    .where(eq(wordArrows.id, id))
    .returning();
  return row;
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
  const { db: _maxVerseDb, lookups: _maxVerseLookups } = isLxx
    ? { db: getLxxDb() ?? getOshbDb(), lookups: lxxLookups }
    : getDbAndLookups(textSource);
  const db = _maxVerseDb;
  const tsId = isLxx ? null : (_maxVerseLookups.textSourceByValue[textSource] ?? null);
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
  transitional: boolean,
  startWordId: string,
  endWordId: string,
  textSource: string,
  book: string,
  chapter: number,
  workspaceId: number,
  commFunction: string | null = null
): Promise<LineAnnotation> {
  const [row] = await userDb
    .insert(lineAnnotations)
    .values({ annotType, label, commFunction, color, description, outOfSequence, transitional, startWordId, endWordId, textSource, book, chapter, workspaceId })
    .returning();
  return row;
}

/** Update fields of an existing annotation (label, commFunction, color, description, outOfSequence, transitional, start/end word IDs). */
export async function updateLineAnnotation(
  id: number,
  updates: Partial<Pick<LineAnnotation, "annotType" | "label" | "commFunction" | "color" | "description" | "outOfSequence" | "transitional" | "startWordId" | "endWordId">>
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

// ── Synoptic Word Marks (word-level comparison marking) ──────────────────────

export async function getChapterSynopticWordMarks(
  book: string,
  chapter: number,
  textSource: string,
  workspaceId: number
): Promise<SynopticWordMark[]> {
  return userDb
    .select()
    .from(synopticWordMarks)
    .where(
      and(
        eq(synopticWordMarks.workspaceId, workspaceId),
        eq(synopticWordMarks.book, book),
        eq(synopticWordMarks.chapter, chapter),
        eq(synopticWordMarks.textSource, textSource)
      )
    )
    .orderBy(asc(synopticWordMarks.createdAt));
}

export async function createSynopticWordMark(
  categoryKey: string,
  color: string,
  startWordId: string,
  endWordId: string,
  textSource: string,
  book: string,
  chapter: number,
  workspaceId: number
): Promise<SynopticWordMark> {
  const [row] = await userDb
    .insert(synopticWordMarks)
    .values({ categoryKey, color, startWordId, endWordId, textSource, book, chapter, workspaceId })
    .returning();
  return row;
}

export async function updateSynopticWordMark(
  id: number,
  updates: Partial<Pick<SynopticWordMark, "categoryKey" | "color">>
): Promise<SynopticWordMark> {
  const [row] = await userDb
    .update(synopticWordMarks)
    .set(updates)
    .where(eq(synopticWordMarks.id, id))
    .returning();
  return row;
}

export async function deleteSynopticWordMark(id: number): Promise<void> {
  await userDb.delete(synopticWordMarks).where(eq(synopticWordMarks.id, id));
}

// ── ULT (UnfoldingWord Literal Text) ─────────────────────────────────────────

/**
 * Synchronous — reads base verse text for a chapter from data/ult.db,
 * remapping KJV-style verse numbers to MT (OSHB) verse numbers where they
 * differ (Jonah ch2 boundary, Joel ch3-4, Malachi ch3 tail, Psalm
 * superscriptions).  The returned `.verse` values always use MT numbering so
 * callers can align directly against OSHB words.
 *
 * Returns an empty array if ult.db has not been imported yet.
 */
export function getUltVerses(
  book: string,
  chapter: number
): { verse: number; text: string }[] {
  const db = getUltSqlite();
  if (!db) return [];
  try {
    const instructions = getMtToKjvInstructions(book, chapter);
    if (!instructions) {
      // No remapping needed — direct query.
      return db
        .prepare("SELECT verse, text FROM ult_verses WHERE book = ? AND chapter = ? ORDER BY verse")
        .all(book, chapter) as { verse: number; text: string }[];
    }

    // Remap: execute one query per instruction, shift verse numbers to MT.
    const stmt = db.prepare(
      "SELECT verse, text FROM ult_verses WHERE book = ? AND chapter = ? AND verse >= ? AND verse <= ? ORDER BY verse"
    );
    const results: { verse: number; text: string }[] = [];
    for (const instr of instructions) {
      const verseEnd = instr.kjvVerseEnd === 999 ? 999_999 : instr.kjvVerseEnd;
      const rows = stmt.all(book, instr.kjvChapter, instr.kjvVerseStart, verseEnd) as {
        verse: number;
        text: string;
      }[];
      for (const row of rows) {
        results.push({ verse: row.verse + instr.mtVerseOffset, text: row.text });
      }
    }
    return results.sort((a, b) => a.verse - b.verse);
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

// ── VCB (Biblica® Open Vietnamese Contemporary Bible 2015) ────────────────────

/**
 * Synchronous — reads verse text for a chapter from data/vcb.db,
 * remapping KJV-style verse numbers to MT (OSHB) verse numbers where they
 * differ (Jonah ch2 boundary, Joel ch3-4, Malachi ch3 tail, Psalm
 * superscriptions).  The returned `.verse` values always use MT numbering so
 * callers can align directly against OSHB words.
 *
 * Returns an empty array if vcb.db has not been imported yet.
 */
export function getVcbVerses(
  book: string,
  chapter: number
): { verse: number; text: string }[] {
  const db = getVcbSqlite();
  if (!db) return [];
  try {
    const instructions = getMtToKjvInstructions(book, chapter);
    if (!instructions) {
      // No remapping needed — direct query.
      return db
        .prepare("SELECT verse, text FROM vcb_verses WHERE book = ? AND chapter = ? ORDER BY verse")
        .all(book, chapter) as { verse: number; text: string }[];
    }

    // Remap: execute one query per instruction, shift verse numbers to MT.
    const stmt = db.prepare(
      "SELECT verse, text FROM vcb_verses WHERE book = ? AND chapter = ? AND verse >= ? AND verse <= ? ORDER BY verse"
    );
    const results: { verse: number; text: string }[] = [];
    for (const instr of instructions) {
      const verseEnd = instr.kjvVerseEnd === 999 ? 999_999 : instr.kjvVerseEnd;
      const rows = stmt.all(book, instr.kjvChapter, instr.kjvVerseStart, verseEnd) as {
        verse: number;
        text: string;
      }[];
      for (const row of rows) {
        results.push({ verse: row.verse + instr.mtVerseOffset, text: row.text });
      }
    }
    return results.sort((a, b) => a.verse - b.verse);
  } catch {
    return [];
  }
}

/**
 * Returns the VCB Translation record, or null if VCB has not been imported.
 */
export async function getVcbTranslation(_workspaceId?: number): Promise<Translation | null> {
  const result = await userDb
    .select()
    .from(translations)
    .where(eq(translations.abbreviation, "VCB"))
    .limit(1);
  return result[0] ?? null;
}

/** Returns distinct book OSIS codes available in ult.db, or [] if not imported. */
export function getUltBooks(): string[] {
  const db = getUltSqlite();
  if (!db) return [];
  try {
    return (db.prepare("SELECT DISTINCT book FROM ult_verses ORDER BY book").all() as { book: string }[]).map(r => r.book);
  } catch { return []; }
}

/** Returns distinct book OSIS codes available in vcb.db, or [] if not imported. */
export function getVcbBooks(): string[] {
  const db = getVcbSqlite();
  if (!db) return [];
  try {
    return (db.prepare("SELECT DISTINCT book FROM vcb_verses ORDER BY book").all() as { book: string }[]).map(r => r.book);
  } catch { return []; }
}

/** Returns a single workspace by ID, or null if not found. */
export async function getWorkspaceById(id: number) {
  const rows = await userDb.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Returns the display name of the user who owns the given workspace, or null
 * if the workspace or its user cannot be found. Used for the PDF export header.
 */
export async function getAuthorName(workspaceId: number): Promise<string | null> {
  const rows = await userDb
    .select({ name: users.name })
    .from(workspaces)
    .innerJoin(users, eq(users.id, workspaces.userId))
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return rows[0]?.name ?? null;
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

// ─── Book Groupings ─────────────────────────────────────────────────────────

export async function getBookGroupings(workspaceId: number): Promise<BookGrouping[]> {
  return userDb
    .select()
    .from(bookGroupings)
    .where(eq(bookGroupings.workspaceId, workspaceId))
    .orderBy(asc(bookGroupings.sortOrder), asc(bookGroupings.id));
}

export async function createBookGrouping(
  workspaceId: number,
  name: string,
  books: string[],
  features: string[]
): Promise<BookGrouping> {
  const [row] = await userDb
    .insert(bookGroupings)
    .values({
      workspaceId,
      name,
      books:    JSON.stringify(books),
      features: JSON.stringify(features),
      sortOrder: 0,
    })
    .returning();
  return row;
}

export async function updateBookGrouping(
  id: number,
  workspaceId: number,
  name: string,
  books: string[],
  features: string[]
): Promise<BookGrouping | undefined> {
  const [row] = await userDb
    .update(bookGroupings)
    .set({ name, books: JSON.stringify(books), features: JSON.stringify(features) })
    .where(and(eq(bookGroupings.id, id), eq(bookGroupings.workspaceId, workspaceId)))
    .returning();
  return row;
}

export async function deleteBookGrouping(id: number, workspaceId: number): Promise<void> {
  await userDb
    .delete(bookGroupings)
    .where(and(eq(bookGroupings.id, id), eq(bookGroupings.workspaceId, workspaceId)));
}


// ─── App Settings ──────────────────────────────────────────────────────────

/** Read a global app setting by key. Returns null if not found. */
export async function getAppSetting(key: string): Promise<string | null> {
  const rows = await userDb
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key));
  return rows[0]?.value ?? null;
}

/** Upsert a global app setting. */
export async function setAppSetting(key: string, value: string): Promise<void> {
  await userDb
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

/** Delete a global app setting. */
export async function deleteAppSetting(key: string): Promise<void> {
  await userDb.delete(appSettings).where(eq(appSettings.key, key));
}

// ─── Translation Footnotes ──────────────────────────────────────────────────

export async function getChapterTranslationFootnotes(
  translationId: number,
  book: string,
  chapter: number,
): Promise<TranslationFootnote[]> {
  try {
    return await userDb
      .select()
      .from(translationFootnotes)
      .where(
        and(
          eq(translationFootnotes.translationId, translationId),
          eq(translationFootnotes.book, book),
          eq(translationFootnotes.chapter, chapter),
        )
      );
  } catch {
    return [];
  }
}

export async function upsertTranslationFootnote(
  workspaceId: number,
  translationId: number,
  osisRef: string,
  type: string,
  content: string,
  wordIndex: number,
  book: string,
  chapter: number,
  verse: number,
): Promise<TranslationFootnote> {
  const [row] = await userDb
    .insert(translationFootnotes)
    .values({ workspaceId, translationId, osisRef, type, content, wordIndex, book, chapter, verse })
    .returning();
  return row;
}

export async function updateTranslationFootnote(
  id: number,
  content: string,
  type?: string,
  wordIndex?: number,
): Promise<void> {
  await userDb
    .update(translationFootnotes)
    .set({
      content,
      ...(type      !== undefined ? { type }      : {}),
      ...(wordIndex !== undefined ? { wordIndex } : {}),
    })
    .where(eq(translationFootnotes.id, id));
}

export async function deleteTranslationFootnote(id: number): Promise<void> {
  await userDb.delete(translationFootnotes).where(eq(translationFootnotes.id, id));
}

// ─── Translation Version History ───────────────────────────────────────────

export async function getTranslationVersions(
  translationId: number,
  osisRef: string,
): Promise<TranslationVersion[]> {
  try {
    return await userDb
      .select()
      .from(translationVersions)
      .where(
        and(
          eq(translationVersions.translationId, translationId),
          eq(translationVersions.osisRef, osisRef),
        )
      )
      .orderBy(sql`${translationVersions.createdAt} DESC`);
  } catch {
    return [];
  }
}

export async function insertTranslationVersion(
  workspaceId: number,
  translationId: number,
  osisRef: string,
  text: string,
  label?: string,
): Promise<TranslationVersion> {
  const [row] = await userDb
    .insert(translationVersions)
    .values({ workspaceId, translationId, osisRef, text, label })
    .returning();
  return row;
}

export async function updateTranslationVersionLabel(
  id: number,
  label: string | null,
): Promise<void> {
  await userDb
    .update(translationVersions)
    .set({ label })
    .where(eq(translationVersions.id, id));
}

export async function deleteTranslationVersion(id: number): Promise<void> {
  await userDb.delete(translationVersions).where(eq(translationVersions.id, id));
}

// ── LXX as Translation Column ─────────────────────────────────────────────────

/**
 * Fetch or create the LXX built-in Translation record (mirrors getUltTranslation).
 * Creating it on first use keeps user.db clean until the feature is actually used.
 */
export async function getLxxTranslation(): Promise<Translation | null> {
  const result = await userDb
    .select()
    .from(translations)
    .where(eq(translations.abbreviation, "LXX"))
    .limit(1);
  if (result[0]) return result[0];
  try {
    const ins = await userDb
      .insert(translations)
      .values({ workspaceId: 1, name: "Septuagint (LXX)", abbreviation: "LXX", language: "greek" })
      .returning();
    return ins[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Reconstruct verse text strings from lxx.db words for a given book/chapter.
 * Words are joined with spaces. Returns [] if lxx.db is unavailable or book not found.
 */
export function getLxxVerseTexts(
  book: string,
  chapter: number
): { verse: number; text: string }[] {
  const sqlite = getLxxSqlite();
  if (!sqlite) return [];
  try {
    const bookRow = sqlite
      .prepare("SELECT id FROM books WHERE osis_code = ?")
      .get(book) as { id: number } | undefined;
    if (!bookRow) return [];

    const rows = sqlite
      .prepare(
        "SELECT verse, surface_text FROM words WHERE book_id = ? AND chapter = ? ORDER BY verse, position_in_verse"
      )
      .all(bookRow.id, chapter) as { verse: number; surface_text: string }[];

    const byVerse = new Map<number, string[]>();
    for (const r of rows) {
      const t = r.surface_text.replace(/\//g, "").trim();
      if (!t) continue;
      const arr = byVerse.get(r.verse);
      if (arr) arr.push(t);
      else byVerse.set(r.verse, [t]);
    }

    return [...byVerse.entries()]
      .sort(([a], [b]) => a - b)
      .map(([verse, tokens]) => ({ verse, text: tokens.join(" ") }));
  } catch {
    return [];
  }
}

/**
 * Return LXX words grouped by verse for a book/chapter.
 * Used to render word tokens in the translation column for TC marking.
 */
export async function getLxxVerseWords(
  book: string,
  chapter: number
): Promise<Map<number, Word[]>> {
  const allWords = await getChapterWords(book, chapter, "STEPBIBLE_LXX" as TextSource);
  const byVerse = new Map<number, Word[]>();
  for (const w of allWords) {
    const arr = byVerse.get(w.verse);
    if (arr) arr.push(w);
    else byVerse.set(w.verse, [w]);
  }
  return byVerse;
}

// ── Text Critical Marks ───────────────────────────────────────────────────────

export function getChapterTextCriticalMarks(
  book: string,
  chapter: number,
  workspaceId: number
): { wordId: string; markType: string; textSource: string }[] {
  return getUserSqlite()
    .prepare(
      "SELECT word_id as wordId, mark_type as markType, text_source as textSource FROM text_critical_marks WHERE workspace_id = ? AND book = ? AND chapter = ?"
    )
    .all(workspaceId, book, chapter) as { wordId: string; markType: string; textSource: string }[];
}

export async function upsertTextCriticalMark(
  wordId: string,
  markType: string,
  textSource: string,
  book: string,
  chapter: number,
  workspaceId: number
): Promise<void> {
  await userDb
    .insert(textCriticalMarks)
    .values({ workspaceId, wordId, markType, textSource, book, chapter })
    .onConflictDoUpdate({
      target: [textCriticalMarks.workspaceId, textCriticalMarks.wordId],
      set: { markType, textSource, book, chapter },
    });
}

export async function deleteTextCriticalMark(
  wordId: string,
  workspaceId: number
): Promise<void> {
  await userDb
    .delete(textCriticalMarks)
    .where(and(eq(textCriticalMarks.workspaceId, workspaceId), eq(textCriticalMarks.wordId, wordId)));
}

// ─── Notes (server-side fetch) ───────────────────────────────────────────────

export async function getNoteContents(
  keys: string[],
  workspaceId: number,
): Promise<Record<string, string>> {
  if (keys.length === 0) return {};
  const rows = await userDb
    .select({ key: notes.key, content: notes.content })
    .from(notes)
    .where(and(eq(notes.workspaceId, workspaceId), inArray(notes.key, keys)));
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.content;
  return result;
}

// ── Intertextual Links ────────────────────────────────────────────────────────

/** Returns all links where source OR target is in the given chapter. */
export async function getIntertextualLinksForChapter(
  book: string,
  chapter: number,
  workspaceId: number
): Promise<IntertextualLink[]> {
  return userDb
    .select()
    .from(intertextualLinks)
    .where(
      and(
        eq(intertextualLinks.workspaceId, workspaceId),
        or(
          and(eq(intertextualLinks.sourceBook, book), eq(intertextualLinks.sourceChapter, chapter)),
          and(eq(intertextualLinks.targetBook, book), eq(intertextualLinks.targetChapter, chapter))
        )
      )
    )
    .orderBy(asc(intertextualLinks.sourceChapter), asc(intertextualLinks.sourceVerse));
}

/** Returns all links where source OR target is in the given book. */
export async function getIntertextualLinksForBook(
  book: string,
  workspaceId: number
): Promise<IntertextualLink[]> {
  return userDb
    .select()
    .from(intertextualLinks)
    .where(
      and(
        eq(intertextualLinks.workspaceId, workspaceId),
        or(
          eq(intertextualLinks.sourceBook, book),
          eq(intertextualLinks.targetBook, book)
        )
      )
    );
}

/** Returns all links in the workspace (for graph view). */
export async function getAllIntertextualLinks(
  workspaceId: number
): Promise<IntertextualLink[]> {
  return userDb
    .select()
    .from(intertextualLinks)
    .where(eq(intertextualLinks.workspaceId, workspaceId));
}

export async function createIntertextualLink(
  payload: {
    sourceBook: string;
    sourceChapter: number;
    sourceVerse: number;
    sourceEndVerse?: number | null;
    sourceTextSource: string;
    sourceStartWordId?: string | null;
    sourceEndWordId?: string | null;
    targetBook: string;
    targetChapter: number;
    targetVerse: number;
    targetEndVerse?: number | null;
    targetTextSource: string;
    targetStartWordId?: string | null;
    targetEndWordId?: string | null;
    linkType: string;
    strength?: number;
    notes?: string | null;
    direction?: string;
    tags?: string;
  },
  workspaceId: number
): Promise<IntertextualLink> {
  const [row] = await userDb
    .insert(intertextualLinks)
    .values({ ...payload, workspaceId })
    .returning();
  return row;
}

export async function updateIntertextualLink(
  id: number,
  patch: Partial<{
    linkType: string;
    strength: number;
    notes: string | null;
    direction: string;
    sourceBook: string;
    sourceChapter: number;
    sourceVerse: number;
    sourceEndVerse: number | null;
    sourceStartWordId: string | null;
    sourceEndWordId: string | null;
    targetBook: string;
    targetChapter: number;
    targetVerse: number;
    targetEndVerse: number | null;
    targetStartWordId: string | null;
    targetEndWordId: string | null;
    tags: string;
  }>
): Promise<IntertextualLink> {
  const [row] = await userDb
    .update(intertextualLinks)
    .set(patch)
    .where(eq(intertextualLinks.id, id))
    .returning();
  return row;
}

export async function deleteIntertextualLink(id: number): Promise<void> {
  await userDb.delete(intertextualLinks).where(eq(intertextualLinks.id, id));
}

