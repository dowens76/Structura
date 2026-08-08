import { NextRequest, NextResponse } from "next/server";
import { parseUsfmFile } from "@/lib/utils/usfm-full-parser";
import { getBook, getOrCreateDefaultVersion } from "@/lib/db/queries";
import { userDb } from "@/lib/db";
import {
  translations, translationVerses, translationFootnotes,
  paragraphBreaks, lineIndents, sceneBreaks,
} from "@/lib/db/schema";
import { and, eq, like } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * POST /api/chapter-usfm
 * Body: { translationId, book, chapter, usfm }
 *
 * Re-imports a single chapter's USFM, replacing existing data for that chapter.
 */
export async function POST(req: NextRequest) {
  const { translationId, book, chapter, usfm } = await req.json() as {
    translationId: number;
    book: string;
    chapter: number;
    usfm: string;
  };

  if (!translationId || !book || !chapter || !usfm?.trim()) {
    return NextResponse.json({ error: "translationId, book, chapter, and usfm are required" }, { status: 400 });
  }

  // Look up translation abbreviation
  const [trans] = await userDb
    .select({ abbreviation: translations.abbreviation })
    .from(translations)
    .where(eq(translations.id, translationId))
    .limit(1);
  if (!trans) return NextResponse.json({ error: "Translation not found" }, { status: 404 });

  const bookRecord = await getBook(book);
  if (!bookRecord) return NextResponse.json({ error: `Book "${book}" not found` }, { status: 404 });

  // Ensure the USFM has an \id line so the parser can detect the book
  const usfmWithId = usfm.trimStart().startsWith("\\id")
    ? usfm
    : `\\id ${book}\n${usfm}`;

  const parsed = await parseUsfmFile(usfmWithId);
  if (parsed.verses.length === 0) {
    return NextResponse.json({ error: "No verses found in USFM" }, { status: 400 });
  }

  const abbr = trans.abbreviation;
  const tvPrefix = `tv:${abbr}:${book}.${chapter}.`;
  const osisChapterPrefix = `${book}.${chapter}.`;
  const BATCH = 500;

  // Delete existing chapter data
  await userDb.delete(translationVerses).where(
    and(
      eq(translationVerses.translationId, translationId),
      like(translationVerses.osisRef, `${osisChapterPrefix}%`)
    )
  );
  await userDb.delete(translationFootnotes).where(
    and(
      eq(translationFootnotes.translationId, translationId),
      eq(translationFootnotes.book, book),
      eq(translationFootnotes.chapter, chapter)
    )
  );

  // Delete paragraph/indent/scene breaks for this chapter's tv prefix
  const deleteByPrefix = async (table: typeof paragraphBreaks | typeof lineIndents | typeof sceneBreaks) => {
    const rows = await userDb.select({ id: table.id, wordId: table.wordId })
      .from(table as typeof paragraphBreaks)
      .where(and(eq((table as typeof paragraphBreaks).book, book), like((table as typeof paragraphBreaks).wordId, `${tvPrefix}%`)));
    for (const row of rows) {
      await userDb.delete(table as typeof paragraphBreaks).where(eq((table as typeof paragraphBreaks).id, row.id));
    }
  };
  await deleteByPrefix(paragraphBreaks);
  await deleteByPrefix(lineIndents);
  await deleteByPrefix(sceneBreaks);

  const textSource = bookRecord.textSource;
  const versionId = await getOrCreateDefaultVersion(1, book, chapter);

  // Insert verses (only this chapter)
  const verseRows = parsed.verses
    .filter(v => v.chapter === chapter)
    .map(v => ({
      workspaceId: 1, translationId, osisRef: v.osisRef,
      bookId: bookRecord.id, chapter: v.chapter, verse: v.verse, text: v.text,
    }));
  for (let i = 0; i < verseRows.length; i += BATCH) {
    await userDb.insert(translationVerses).values(verseRows.slice(i, i + BATCH));
  }

  // Insert footnotes (only this chapter)
  const fnRows = parsed.footnotes
    .filter(fn => fn.chapter === chapter)
    .map(fn => ({
      workspaceId: 1, translationId, osisRef: fn.osisRef,
      type: fn.type, content: fn.content, wordIndex: fn.wordIndex,
      book: fn.book, chapter: fn.chapter, verse: fn.verse,
    }));
  for (let i = 0; i < fnRows.length; i += BATCH) {
    if (fnRows.slice(i, i + BATCH).length > 0)
      await userDb.insert(translationFootnotes).values(fnRows.slice(i, i + BATCH));
  }

  // Insert paragraph breaks
  const pbRows = parsed.paragraphBreaks
    .filter(pb => pb.osisRef.startsWith(osisChapterPrefix))
    .map(pb => {
      const [, ch] = pb.osisRef.split(".");
      return { workspaceId: 1, versionId, wordId: `tv:${abbr}:${pb.osisRef}`, textSource, book, chapter: parseInt(ch, 10) };
    });
  for (let i = 0; i < pbRows.length; i += BATCH) {
    if (pbRows.slice(i, i + BATCH).length > 0)
      await userDb.insert(paragraphBreaks).values(pbRows.slice(i, i + BATCH)).onConflictDoNothing();
  }

  // Insert line indents
  const liRows = parsed.lineIndents
    .filter(li => li.osisRef.startsWith(osisChapterPrefix))
    .map(li => {
      const [, ch] = li.osisRef.split(".");
      return { workspaceId: 1, versionId, wordId: `tv:${abbr}:${li.osisRef}`, indentLevel: li.level, textSource, book, chapter: parseInt(ch, 10) };
    });
  for (let i = 0; i < liRows.length; i += BATCH) {
    if (liRows.slice(i, i + BATCH).length > 0)
      await userDb.insert(lineIndents).values(liRows.slice(i, i + BATCH)).onConflictDoNothing();
  }

  // Insert section breaks
  const sbRows = parsed.sectionBreaks
    .filter(sb => sb.osisRef.startsWith(osisChapterPrefix))
    .map(sb => {
      const [, ch, v] = sb.osisRef.split(".");
      return {
        workspaceId: 1, versionId, wordId: `tv:${abbr}:${sb.osisRef}`, heading: sb.heading,
        level: sb.level, verse: parseInt(v ?? "1", 10), outOfSequence: false,
        extendedThrough: null, thematic: false, thematicLetter: null,
        textSource, book, chapter: parseInt(ch, 10),
      };
    });
  for (let i = 0; i < sbRows.length; i += BATCH) {
    if (sbRows.slice(i, i + BATCH).length > 0)
      await userDb.insert(sceneBreaks).values(sbRows.slice(i, i + BATCH)).onConflictDoNothing();
  }

  return NextResponse.json({ success: true, verseCount: verseRows.length });
}
