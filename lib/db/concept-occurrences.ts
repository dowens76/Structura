import { eq, and, inArray, asc } from "drizzle-orm";
import { userDb, sourceDb, getLxxDb, getUltSqlite, getOshbDb, getSblgntDb } from "@/lib/db";
import { wordTagRefs, translations, translationVerses } from "@/lib/db/user-schema";
import { books, words } from "@/lib/db/source-schema";
import { OSIS_BOOKS_OT, OSIS_BOOKS_NT, OSIS_BOOKS_LXX } from "@/lib/utils/osis";

/**
 * Which per-source DB actually holds a book's words. Can't be inferred from
 * ref.textSource alone: for words tagged inside a translation's own text
 * (tv:-prefixed word ids), textSource holds the translation's abbreviation
 * (e.g. "ESV"), not the underlying original-language source.
 */
function resolveSourceKind(book: string, textSource: string): "lxx" | "sblgnt" | "oshb" {
  if (textSource === "STEPBIBLE_LXX") return "lxx";
  if ((OSIS_BOOKS_NT as readonly string[]).includes(book)) return "sblgnt";
  if (!(OSIS_BOOKS_OT as readonly string[]).includes(book) && (OSIS_BOOKS_LXX as readonly string[]).includes(book)) return "lxx";
  return "oshb";
}

export interface RawOccurrenceRef { wordId: string; book: string; chapter: number; textSource: string }

export interface ResolvedOccurrence {
  wordId: string;
  book: string;
  chapter: number;
  verse: number;
  textSource: string;
  osisRef: string;
  reference: string;
  sourceText: string;
  /** translationId -> resolved text. Only populated for the requested translationIds
   *  (or every imported translation, if none were requested). */
  translationTexts: Map<number, string>;
}

/**
 * Resolves every occurrence referenced by the given wordTagRefs.tagId set into
 * display-ready rows. Thin wrapper around resolveOccurrenceRefs() for the
 * Word/Concept Editor's occurrence table.
 */
export async function resolveWordTagOccurrences(
  tagIds: number[],
  opts: { bookFilter?: string[]; translationIds?: number[] } = {}
): Promise<ResolvedOccurrence[]> {
  if (tagIds.length === 0) return [];
  const { bookFilter, ...rest } = opts;

  const refConditions = [inArray(wordTagRefs.tagId, tagIds)];
  if (bookFilter && bookFilter.length > 0) refConditions.push(inArray(wordTagRefs.book, bookFilter));
  const refs: RawOccurrenceRef[] = await userDb.select({
    wordId: wordTagRefs.wordId, book: wordTagRefs.book,
    chapter: wordTagRefs.chapter, textSource: wordTagRefs.textSource,
  }).from(wordTagRefs).where(and(...refConditions));

  return resolveOccurrenceRefs(refs, rest);
}

/**
 * Resolves a set of raw (wordId, book, chapter, textSource) refs into
 * display-ready rows: canonical reference, source text, and translation text.
 * Shared by the tag-lists CSV export (for both word-tag and character refs)
 * and the Word/Concept Editor occurrence table so the ref/verse/translation
 * resolution logic (incl. the LXX word-id lookup and the ULT-fallback-to-base-
 * text path) lives in one place.
 */
export async function resolveOccurrenceRefs(
  refs: RawOccurrenceRef[],
  opts: { translationIds?: number[] } = {}
): Promise<ResolvedOccurrence[]> {
  const { translationIds } = opts;
  if (refs.length === 0) return [];

  // ── Resolve verse number for each ref ─────────────────────────────────────

  interface VerseRef { wordId: string; book: string; chapter: number; verse: number; textSource: string; osisRef: string }

  const verseRefs: VerseRef[] = [];
  const lxxWordIds: string[] = [];
  const oshbLookupRefs: RawOccurrenceRef[] = [];
  const sblgntLookupRefs: RawOccurrenceRef[] = [];

  for (const ref of refs) {
    if (ref.textSource === "STEPBIBLE_LXX") {
      lxxWordIds.push(ref.wordId);
    } else if (ref.wordId.startsWith("tv:")) {
      // Synthetic id for a word tagged inside a translation's own text:
      // tv:ABBR:BOOK.CHAPTER.VERSE.POS (see ChapterDisplay.tsx's tv: parsing).
      // Not a real row in any words table, so parse it directly instead of
      // looking it up.
      const dotParts = ref.wordId.split(":")[2]?.split(".") ?? [];
      if (dotParts.length > 2) {
        const verse = parseInt(dotParts[2], 10);
        if (!isNaN(verse)) {
          verseRefs.push({ wordId: ref.wordId, book: ref.book, chapter: ref.chapter, verse, textSource: ref.textSource, osisRef: `${ref.book}.${ref.chapter}.${verse}` });
        }
      }
    } else {
      // A real source-word id. These are NOT reliably parseable as
      // SOURCE.BOOK.CHAPTER.VERSE.POS — OSHB ids are opaque native codes
      // from the morphhb XML (e.g. "19PUg"), only SBLGNT's synthetic
      // GNT.book.ch.v.pos ids happen to be parseable. Always resolve the
      // verse via a DB lookup instead of assuming a string shape.
      (resolveSourceKind(ref.book, ref.textSource) === "sblgnt" ? sblgntLookupRefs : oshbLookupRefs).push(ref);
    }
  }

  // Resolve LXX verse numbers by querying lxxDb
  if (lxxWordIds.length > 0) {
    const lxxDb = getLxxDb();
    if (lxxDb) {
      const CHUNK = 900;
      for (let i = 0; i < lxxWordIds.length; i += CHUNK) {
        const chunk = lxxWordIds.slice(i, i + CHUNK);
        const rows = await lxxDb
          .select({ wordId: words.wordId, bookId: words.bookId, chapter: words.chapter, verse: words.verse })
          .from(words)
          .where(inArray(words.wordId, chunk));
        const bookIds = [...new Set(rows.map((r) => r.bookId))];
        const bookRows = await sourceDb
          .select({ id: books.id, osisCode: books.osisCode })
          .from(books)
          .where(inArray(books.id, bookIds));
        const bookOsisMap = new Map(bookRows.map((b) => [b.id, b.osisCode]));
        for (const r of rows) {
          const osisBook = bookOsisMap.get(r.bookId);
          if (osisBook) {
            verseRefs.push({ wordId: r.wordId, book: osisBook, chapter: r.chapter, verse: r.verse, textSource: "STEPBIBLE_LXX", osisRef: `${osisBook}.${r.chapter}.${r.verse}` });
          }
        }
      }
    }
  }

  // Resolve OSHB/SBLGNT verse numbers by looking up each word's own row.
  async function resolveByWordId(db: ReturnType<typeof getOshbDb>, lookupRefs: RawOccurrenceRef[]) {
    if (lookupRefs.length === 0) return;
    const refsByWordId = new Map(lookupRefs.map((r) => [r.wordId, r]));
    const wordIds = lookupRefs.map((r) => r.wordId);
    const CHUNK = 900;
    for (let i = 0; i < wordIds.length; i += CHUNK) {
      const chunk = wordIds.slice(i, i + CHUNK);
      const rows = await db
        .select({ wordId: words.wordId, chapter: words.chapter, verse: words.verse })
        .from(words)
        .where(inArray(words.wordId, chunk));
      for (const r of rows) {
        const orig = refsByWordId.get(r.wordId);
        if (orig) {
          verseRefs.push({ wordId: r.wordId, book: orig.book, chapter: r.chapter, verse: r.verse, textSource: orig.textSource, osisRef: `${orig.book}.${r.chapter}.${r.verse}` });
        }
      }
    }
  }
  await resolveByWordId(getOshbDb(), oshbLookupRefs);
  await resolveByWordId(getSblgntDb(), sblgntLookupRefs);

  // ── Deduplicate by osisRef+wordId, then sort canonically ──────────────────
  // (unlike the CSV export, the editor needs one row per occurrence, not one
  // row per verse — but multiple tagged words can share a verse, so dedupe on
  // wordId, which is unique per occurrence.)

  const uniqueRefMap = new Map<string, VerseRef>();
  for (const vr of verseRefs) {
    if (!uniqueRefMap.has(vr.wordId)) uniqueRefMap.set(vr.wordId, vr);
  }

  const allBooksData = await sourceDb
    .select({ osisCode: books.osisCode, name: books.name, bookNumber: books.bookNumber })
    .from(books);
  const bookNumberMap = new Map(allBooksData.map((b) => [b.osisCode, b.bookNumber]));
  const bookNameMap = new Map(allBooksData.map((b) => [b.osisCode, b.name]));

  const uniqueRefs = Array.from(uniqueRefMap.values()).sort((a, b) => {
    const bn = (bookNumberMap.get(a.book) ?? 999) - (bookNumberMap.get(b.book) ?? 999);
    if (bn !== 0) return bn;
    if (a.chapter !== b.chapter) return a.chapter - b.chapter;
    return a.verse - b.verse;
  });

  // ── Build verse surface text ───────────────────────────────────────────────

  const verseTextMap = new Map<string, string>();
  const chapterKeys = new Map<string, { book: string; chapter: number; textSource: string }>();
  for (const ref of uniqueRefs) {
    const key = `${ref.textSource}::${ref.book}::${ref.chapter}`;
    if (!chapterKeys.has(key)) chapterKeys.set(key, { book: ref.book, chapter: ref.chapter, textSource: ref.textSource });
  }

  for (const { book, chapter, textSource } of chapterKeys.values()) {
    let chapterWordRows: { verse: number; surfaceText: string; positionInVerse: number }[] = [];

    const kind = resolveSourceKind(book, textSource);
    const db = kind === "lxx" ? getLxxDb() : kind === "sblgnt" ? getSblgntDb() : getOshbDb();
    if (db) {
      const bookRows = await db.select({ id: books.id }).from(books).where(eq(books.osisCode, book));
      if (bookRows.length > 0) {
        chapterWordRows = await db
          .select({ verse: words.verse, surfaceText: words.surfaceText, positionInVerse: words.positionInVerse })
          .from(words)
          .where(and(eq(words.bookId, bookRows[0].id), eq(words.chapter, chapter)))
          .orderBy(asc(words.verse), asc(words.positionInVerse));
      }
    }

    const verseWordMap = new Map<number, string[]>();
    for (const w of chapterWordRows) {
      const text = w.surfaceText.replace(/\//g, "");
      const arr = verseWordMap.get(w.verse) ?? [];
      arr.push(text);
      verseWordMap.set(w.verse, arr);
    }
    for (const [verse, wordTexts] of verseWordMap) {
      verseTextMap.set(`${book}.${chapter}.${verse}`, wordTexts.join(" "));
    }
  }

  // ── Fetch translation verses ───────────────────────────────────────────────

  const allTranslations = translationIds && translationIds.length > 0
    ? await userDb.select().from(translations).where(inArray(translations.id, translationIds))
    : await userDb.select().from(translations).orderBy(asc(translations.abbreviation));

  const transTextMap = new Map<string, string>(); // `${translationId}.${osisRef}` → text

  if (allTranslations.length > 0 && uniqueRefs.length > 0) {
    const allOsisRefs = [...new Set(uniqueRefs.map((r) => r.osisRef))];
    const CHUNK = 900;
    for (let i = 0; i < allOsisRefs.length; i += CHUNK) {
      const chunk = allOsisRefs.slice(i, i + CHUNK);
      const tvRows = await userDb
        .select({ translationId: translationVerses.translationId, osisRef: translationVerses.osisRef, text: translationVerses.text })
        .from(translationVerses)
        .where(inArray(translationVerses.osisRef, chunk));
      for (const row of tvRows) {
        if (allTranslations.some((t) => t.id === row.translationId)) {
          transTextMap.set(`${row.translationId}.${row.osisRef}`, row.text);
        }
      }
    }
  }

  // ── ULT fallback: fill missing verses from ult.db base text ──────────────
  // translationVerses only stores user edits; unedited ULT verses must be
  // read directly from ult.db.
  const ultTranslation = allTranslations.find((t) => t.abbreviation === "ULT");
  if (ultTranslation) {
    const ultSqlite = getUltSqlite();
    if (ultSqlite) {
      const ultChapters = new Map<string, { book: string; chapter: number }>();
      for (const ref of uniqueRefs) {
        const key = `${ref.book}.${ref.chapter}`;
        if (!ultChapters.has(key)) ultChapters.set(key, { book: ref.book, chapter: ref.chapter });
      }
      const stmt = ultSqlite.prepare(
        "SELECT verse, text FROM ult_verses WHERE book = ? AND chapter = ? ORDER BY verse"
      );
      for (const { book, chapter } of ultChapters.values()) {
        const ultRows = stmt.all(book, chapter) as { verse: number; text: string }[];
        for (const row of ultRows) {
          const osisRef = `${book}.${chapter}.${row.verse}`;
          const mapKey = `${ultTranslation.id}.${osisRef}`;
          if (!transTextMap.has(mapKey)) {
            transTextMap.set(mapKey, row.text);
          }
        }
      }
    }
  }

  // ── Assemble result ─────────────────────────────────────────────────────────

  return uniqueRefs.map((ref) => {
    const bookDisplayName = bookNameMap.get(ref.book) ?? ref.book;
    const translationTexts = new Map<number, string>();
    for (const t of allTranslations) {
      const text = transTextMap.get(`${t.id}.${ref.osisRef}`);
      if (text !== undefined) translationTexts.set(t.id, text);
    }
    return {
      wordId: ref.wordId,
      book: ref.book,
      chapter: ref.chapter,
      verse: ref.verse,
      textSource: ref.textSource,
      osisRef: ref.osisRef,
      reference: `${bookDisplayName} ${ref.chapter}:${ref.verse}`,
      sourceText: verseTextMap.get(ref.osisRef) ?? "",
      translationTexts,
    };
  });
}
