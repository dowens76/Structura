import { NextRequest, NextResponse } from "next/server";
import {
  getBookTranslationVerses,
  getChapterTranslationFootnotes,
  getBook,
} from "@/lib/db/queries";
import { userDb } from "@/lib/db";
import { paragraphBreaks, lineIndents, sceneBreaks, translations } from "@/lib/db/schema";
import { and, eq, like } from "drizzle-orm";
import { exportToUsfm } from "@/lib/utils/usfm-exporter";
import type { UsfmExportData } from "@/lib/utils/usfm-exporter";

export const dynamic = "force-dynamic";

/**
 * GET /api/export/usfm?translationId=N&book=Gen
 * Returns a USFM file download for the given translation + book.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const translationId = parseInt(searchParams.get("translationId") ?? "0", 10);
  const book          = searchParams.get("book") ?? "";

  if (!translationId || !book) {
    return NextResponse.json({ error: "translationId and book are required" }, { status: 400 });
  }

  // Look up the translation
  const [trans] = await userDb
    .select()
    .from(translations)
    .where(eq(translations.id, translationId))
    .limit(1);
  if (!trans) {
    return NextResponse.json({ error: "Translation not found" }, { status: 404 });
  }

  // Look up the book
  const bookRecord = await getBook(book);
  if (!bookRecord) {
    return NextResponse.json({ error: `Book "${book}" not found` }, { status: 404 });
  }

  // Fetch all verses for the book
  const verses = await getBookTranslationVerses(translationId, book);
  if (verses.length === 0) {
    return NextResponse.json({ error: "No verses found for this translation and book" }, { status: 404 });
  }

  // Fetch all footnotes for the book
  const allFootnotes = [];
  const chapters = new Set(verses.map(v => v.chapter));
  for (const ch of chapters) {
    const fns = await getChapterTranslationFootnotes(translationId, book, ch);
    allFootnotes.push(...fns);
  }

  // Fetch paragraph breaks (tv:{abbr}: prefix)
  const abbr = trans.abbreviation;
  const tvPrefix = `tv:${abbr}:${book}.`;
  const allParaBreaks = await userDb
    .select()
    .from(paragraphBreaks)
    .where(and(eq(paragraphBreaks.book, book), like(paragraphBreaks.wordId, `${tvPrefix}%`)));

  const paraBreakSet = new Set<string>(
    allParaBreaks.map(pb => {
      // Extract osisRef from wordId: tv:{abbr}:{osisRef}
      return pb.wordId.slice(`tv:${abbr}:`.length);
    })
  );

  // Fetch line indents
  const allLineIndents = await userDb
    .select()
    .from(lineIndents)
    .where(and(eq(lineIndents.book, book), like(lineIndents.wordId, `${tvPrefix}%`)));

  const indentMap = new Map<string, number>(
    allLineIndents.map(li => [li.wordId.slice(`tv:${abbr}:`.length), li.indentLevel])
  );

  // Fetch section breaks
  const allSceneBreaks = await userDb
    .select()
    .from(sceneBreaks)
    .where(and(eq(sceneBreaks.book, book), like(sceneBreaks.wordId, `${tvPrefix}%`)));

  const sectionMap = new Map<string, { heading: string; level: number }>(
    allSceneBreaks
      .filter(sb => sb.heading)
      .map(sb => [
        sb.wordId.slice(`tv:${abbr}:`.length),
        { heading: sb.heading!, level: sb.level },
      ])
  );

  const exportData: UsfmExportData = {
    book,
    bookName: bookRecord.name,
    abbr,
    verses,
    footnotes:  allFootnotes,
    paraBreaks: paraBreakSet,
    indents:    indentMap,
    sections:   sectionMap,
  };

  const usfmText = exportToUsfm(exportData);
  const filename  = `${abbr}_${book}.usfm`;

  return new NextResponse(usfmText, {
    status: 200,
    headers: {
      "Content-Type":        "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
