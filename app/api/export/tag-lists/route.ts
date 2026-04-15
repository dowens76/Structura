import { NextRequest, NextResponse } from "next/server";
import { eq, and, inArray, or, asc, sql } from "drizzle-orm";
import { userDb, sourceDb, getLxxDb, getUltSqlite } from "@/lib/db";
import {
  wordTags,
  wordTagRefs,
  characters,
  characterRefs,
  translations,
  translationVerses,
} from "@/lib/db/user-schema";
import { books, words } from "@/lib/db/source-schema";
import { getActiveWorkspaceId } from "@/lib/workspace";

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

  interface RawRef { wordId: string; book: string; chapter: number; textSource: string }
  let refs: RawRef[] = [];

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

  // ── Resolve verse number for each ref ─────────────────────────────────────

  interface VerseRef { wordId: string; book: string; chapter: number; verse: number; textSource: string; osisRef: string }

  const verseRefs: VerseRef[] = [];
  const lxxWordIds: string[] = [];
  const lxxRefsByWordId = new Map<string, RawRef>();

  for (const ref of refs) {
    if (ref.textSource === "STEPBIBLE_LXX") {
      lxxWordIds.push(ref.wordId);
      lxxRefsByWordId.set(ref.wordId, ref);
    } else {
      // Format: SOURCE.BOOK.CHAPTER.VERSE.POS  (e.g. OSHB.Gen.1.3.2)
      const parts = ref.wordId.split(".");
      if (parts.length >= 4) {
        const verse = parseInt(parts[3], 10);
        if (!isNaN(verse)) {
          verseRefs.push({ wordId: ref.wordId, book: ref.book, chapter: ref.chapter, verse, textSource: ref.textSource, osisRef: `${ref.book}.${ref.chapter}.${verse}` });
        }
      }
    }
  }

  // Resolve LXX verse numbers by querying lxxDb
  if (lxxWordIds.length > 0) {
    const lxxDb = getLxxDb();
    if (lxxDb) {
      // Batch query; split into chunks if needed (SQLite IN limit is 999)
      const CHUNK = 900;
      for (let i = 0; i < lxxWordIds.length; i += CHUNK) {
        const chunk = lxxWordIds.slice(i, i + CHUNK);
        const rows = await lxxDb
          .select({ wordId: words.wordId, bookId: words.bookId, chapter: words.chapter, verse: words.verse })
          .from(words)
          .where(inArray(words.wordId, chunk));
        // Resolve bookIds to osis codes
        const bookIds = [...new Set(rows.map((r) => r.bookId))];
        const bookRows = await sourceDb
          .select({ id: books.id, osisCode: books.osisCode })
          .from(books)
          .where(inArray(books.id, bookIds));
        const bookOsisMap = new Map(bookRows.map((b) => [b.id, b.osisCode]));
        for (const r of rows) {
          const osisBook = bookOsisMap.get(r.bookId);
          if (osisBook) {
            const ref = lxxRefsByWordId.get(r.wordId);
            verseRefs.push({ wordId: r.wordId, book: osisBook, chapter: r.chapter, verse: r.verse, textSource: "STEPBIBLE_LXX", osisRef: `${osisBook}.${r.chapter}.${r.verse}` });
            void ref;
          }
        }
      }
    }
  }

  // ── Deduplicate by osisRef, then sort canonically ─────────────────────────

  const uniqueRefMap = new Map<string, VerseRef>();
  for (const vr of verseRefs) {
    if (!uniqueRefMap.has(vr.osisRef)) uniqueRefMap.set(vr.osisRef, vr);
  }

  // Load book order/names
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

  // Group needed verses by (book, chapter, textSource)
  const chapterKeys = new Map<string, { book: string; chapter: number; textSource: string }>();
  for (const ref of uniqueRefs) {
    const key = `${ref.textSource}::${ref.book}::${ref.chapter}`;
    if (!chapterKeys.has(key)) chapterKeys.set(key, { book: ref.book, chapter: ref.chapter, textSource: ref.textSource });
  }

  // Resolve source book IDs once
  const sourceBookRows = await sourceDb.select({ id: books.id, osisCode: books.osisCode }).from(books);
  const sourceBookIdMap = new Map(sourceBookRows.map((b) => [b.osisCode, b.id]));

  for (const { book, chapter, textSource } of chapterKeys.values()) {
    let chapterWordRows: { verse: number; surfaceText: string; positionInVerse: number }[] = [];

    if (textSource === "STEPBIBLE_LXX") {
      const lxxDb = getLxxDb();
      if (lxxDb) {
        const lxxBookRows = await lxxDb.select({ id: books.id }).from(books).where(eq(books.osisCode, book));
        if (lxxBookRows.length > 0) {
          chapterWordRows = await lxxDb
            .select({ verse: words.verse, surfaceText: words.surfaceText, positionInVerse: words.positionInVerse })
            .from(words)
            .where(and(eq(words.bookId, lxxBookRows[0].id), eq(words.chapter, chapter)))
            .orderBy(asc(words.verse), asc(words.positionInVerse));
        }
      }
    } else {
      const bookId = sourceBookIdMap.get(book);
      if (bookId != null) {
        chapterWordRows = await sourceDb
          .select({ verse: words.verse, surfaceText: words.surfaceText, positionInVerse: words.positionInVerse })
          .from(words)
          .where(and(eq(words.bookId, bookId), eq(words.chapter, chapter)))
          .orderBy(asc(words.verse), asc(words.positionInVerse));
      }
    }

    // Group by verse and build surface text
    const verseWordMap = new Map<number, string[]>();
    for (const w of chapterWordRows) {
      const text = w.surfaceText.replace(/\//g, "");
      const arr = verseWordMap.get(w.verse) ?? [];
      arr.push(text);
      verseWordMap.set(w.verse, arr);
    }
    for (const [verse, words2] of verseWordMap) {
      verseTextMap.set(`${book}.${chapter}.${verse}`, words2.join(" "));
    }
  }

  // ── Fetch translation verses ───────────────────────────────────────────────

  const transTextMap = new Map<string, string>(); // `${translationId}.${osisRef}` → text

  if (allTranslations.length > 0 && uniqueRefs.length > 0) {
    const allOsisRefs = uniqueRefs.map((r) => r.osisRef);
    const CHUNK = 900;
    for (let i = 0; i < allOsisRefs.length; i += CHUNK) {
      const chunk = allOsisRefs.slice(i, i + CHUNK);
      const tvRows = await userDb
        .select({ translationId: translationVerses.translationId, osisRef: translationVerses.osisRef, text: translationVerses.text })
        .from(translationVerses)
        .where(inArray(translationVerses.osisRef, chunk));
      for (const row of tvRows) {
        transTextMap.set(`${row.translationId}.${row.osisRef}`, row.text);
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
      // Group needed (book, chapter) pairs
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
          // Only set if no user edit already present
          if (!transTextMap.has(mapKey)) {
            transTextMap.set(mapKey, row.text);
          }
        }
      }
    }
  }

  // ── Build CSV ──────────────────────────────────────────────────────────────

  function csvField(val: string): string {
    if (/[,"\n\r]/.test(val)) return '"' + val.replace(/"/g, '""') + '"';
    return val;
  }

  const header = ["Reference", "Source Text", ...allTranslations.map((t) => t.abbreviation)].map(csvField).join(",");

  const rows = uniqueRefs.map((ref) => {
    const bookDisplayName = bookNameMap.get(ref.book) ?? ref.book;
    const reference = `${bookDisplayName} ${ref.chapter}:${ref.verse}`;
    const sourceText = verseTextMap.get(ref.osisRef) ?? "";
    const transCols = allTranslations.map((t) => transTextMap.get(`${t.id}.${ref.osisRef}`) ?? "");
    return [reference, sourceText, ...transCols].map(csvField).join(",");
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
