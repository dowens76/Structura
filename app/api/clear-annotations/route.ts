import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  paragraphBreaks,
  characterRefs,
  speechSections,
  wordTagRefs,
  lineIndents,
  wordArrows,
  wordFormatting,
  clauseRelationships,
} from "@/lib/db/schema";
import { and, eq, gte, lte, type SQL } from "drizzle-orm";

const VALID_CATEGORIES = [
  "paragraphBreaks",
  "characterRefs",
  "speechSections",
  "wordTagRefs",
  "lineIndents",
  "wordArrows",
  "wordFormatting",
  "clauseRelationships",
] as const;
type Category = (typeof VALID_CATEGORIES)[number];

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    book: string;
    textSource: string;
    startChapter: number;
    endChapter: number;
    categories: string[];
  };

  const { book, textSource, startChapter, endChapter, categories } = body;
  if (!book || !textSource || !startChapter || !endChapter || !Array.isArray(categories)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const toDelete = categories.filter((c): c is Category =>
    VALID_CATEGORIES.includes(c as Category)
  );
  if (toDelete.length === 0) return NextResponse.json({ cleared: [] });

  // Build chapter condition inline for each table (avoids cross-table column type mismatch)
  function chapterCond<T>(col: T): SQL {
    return (startChapter === endChapter
      ? eq(col as Parameters<typeof eq>[0], startChapter)
      : and(
          gte(col as Parameters<typeof gte>[0], startChapter),
          lte(col as Parameters<typeof lte>[0], endChapter),
        )!) as SQL;
  }

  const cleared: Category[] = [];
  for (const cat of toDelete) {
    switch (cat) {
      case "paragraphBreaks":
        await db.delete(paragraphBreaks).where(
          and(eq(paragraphBreaks.book, book), chapterCond(paragraphBreaks.chapter), eq(paragraphBreaks.textSource, textSource))
        );
        break;
      case "characterRefs":
        await db.delete(characterRefs).where(
          and(eq(characterRefs.book, book), chapterCond(characterRefs.chapter), eq(characterRefs.textSource, textSource))
        );
        break;
      case "speechSections":
        await db.delete(speechSections).where(
          and(eq(speechSections.book, book), chapterCond(speechSections.chapter), eq(speechSections.textSource, textSource))
        );
        break;
      case "wordTagRefs":
        await db.delete(wordTagRefs).where(
          and(eq(wordTagRefs.book, book), chapterCond(wordTagRefs.chapter), eq(wordTagRefs.textSource, textSource))
        );
        break;
      case "lineIndents":
        await db.delete(lineIndents).where(
          and(eq(lineIndents.book, book), chapterCond(lineIndents.chapter), eq(lineIndents.textSource, textSource))
        );
        break;
      case "wordArrows":
        await db.delete(wordArrows).where(
          and(eq(wordArrows.book, book), chapterCond(wordArrows.chapter), eq(wordArrows.textSource, textSource))
        );
        break;
      case "wordFormatting":
        await db.delete(wordFormatting).where(
          and(eq(wordFormatting.book, book), chapterCond(wordFormatting.chapter), eq(wordFormatting.textSource, textSource))
        );
        break;
      case "clauseRelationships":
        await db.delete(clauseRelationships).where(
          and(eq(clauseRelationships.book, book), chapterCond(clauseRelationships.chapter), eq(clauseRelationships.textSource, textSource))
        );
        break;
    }
    cleared.push(cat);
  }

  return NextResponse.json({ cleared });
}
