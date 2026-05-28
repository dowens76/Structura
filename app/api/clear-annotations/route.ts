import { NextRequest, NextResponse } from "next/server";
import { userDb } from "@/lib/db";
import {
  paragraphBreaks,
  characterRefs,
  speechSections,
  wordTagRefs,
  lineIndents,
  wordArrows,
  wordFormatting,
  clauseRelationships,
  rstRelations,
  lineAnnotations,
} from "@/lib/db/schema";
import { and, eq, gte, lte, type SQL } from "drizzle-orm";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const VALID_CATEGORIES = [
  "paragraphBreaks",
  "characterRefs",
  "speechSections",
  "wordTagRefs",
  "lineIndents",
  "wordArrows",
  "wordFormatting",
  "clauseRelationships",
  "rstRelations",
  "lineAnnotations",
] as const;
type Category = (typeof VALID_CATEGORIES)[number];

export async function POST(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
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
        // No textSource filter — getChapterParagraphBreaks loads all sources
        await userDb.delete(paragraphBreaks).where(
          and(eq(paragraphBreaks.workspaceId, workspaceId), eq(paragraphBreaks.book, book), chapterCond(paragraphBreaks.chapter))
        );
        break;
      case "characterRefs":
        // No textSource filter — refs are loaded cross-source (getChapterCharacterRefs has no source filter)
        await userDb.delete(characterRefs).where(
          and(eq(characterRefs.workspaceId, workspaceId), eq(characterRefs.book, book), chapterCond(characterRefs.chapter))
        );
        break;
      case "speechSections":
        await userDb.delete(speechSections).where(
          and(eq(speechSections.workspaceId, workspaceId), eq(speechSections.book, book), chapterCond(speechSections.chapter), eq(speechSections.textSource, textSource))
        );
        break;
      case "wordTagRefs":
        // No textSource filter — refs are loaded cross-source (getChapterWordTagRefs has no source filter)
        await userDb.delete(wordTagRefs).where(
          and(eq(wordTagRefs.workspaceId, workspaceId), eq(wordTagRefs.book, book), chapterCond(wordTagRefs.chapter))
        );
        break;
      case "lineIndents":
        // No textSource filter — getChapterLineIndents loads all sources
        await userDb.delete(lineIndents).where(
          and(eq(lineIndents.workspaceId, workspaceId), eq(lineIndents.book, book), chapterCond(lineIndents.chapter))
        );
        break;
      case "wordArrows":
        await userDb.delete(wordArrows).where(
          and(eq(wordArrows.workspaceId, workspaceId), eq(wordArrows.book, book), chapterCond(wordArrows.chapter), eq(wordArrows.textSource, textSource))
        );
        break;
      case "wordFormatting":
        // No textSource filter — getChapterWordFormatting loads all sources
        await userDb.delete(wordFormatting).where(
          and(eq(wordFormatting.workspaceId, workspaceId), eq(wordFormatting.book, book), chapterCond(wordFormatting.chapter))
        );
        break;
      case "clauseRelationships":
        await userDb.delete(clauseRelationships).where(
          and(eq(clauseRelationships.workspaceId, workspaceId), eq(clauseRelationships.book, book), chapterCond(clauseRelationships.chapter), eq(clauseRelationships.textSource, textSource))
        );
        break;
      case "rstRelations":
        await userDb.delete(rstRelations).where(
          and(eq(rstRelations.workspaceId, workspaceId), eq(rstRelations.book, book), chapterCond(rstRelations.chapter), eq(rstRelations.textSource, textSource))
        );
        break;
      case "lineAnnotations":
        await userDb.delete(lineAnnotations).where(
          and(eq(lineAnnotations.workspaceId, workspaceId), eq(lineAnnotations.book, book), chapterCond(lineAnnotations.chapter), eq(lineAnnotations.textSource, textSource))
        );
        break;
    }
    cleared.push(cat);
  }

  return NextResponse.json({ cleared });
}
