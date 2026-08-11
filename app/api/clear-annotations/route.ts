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
  rstRelations,
  lineGroups,
  lineAnnotations,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { getActiveVersionId } from "@/lib/versions/activeVersion";

export const dynamic = "force-dynamic";

const VALID_CATEGORIES = [
  "paragraphBreaks",
  "characterRefs",
  "speechSections",
  "wordTagRefs",
  "lineIndents",
  "wordArrows",
  "wordFormatting",
  "rstRelations",
  "lineGroups",
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

  // Clearing must only touch the ACTIVE version's markup at each chapter, not
  // every version's — versions are per-chapter, so each chapter in the range
  // can have a different active version and needs its own delete pass.
  const chapters: number[] = [];
  for (let ch = startChapter; ch <= endChapter; ch++) chapters.push(ch);

  const cleared: Category[] = [];
  for (const cat of toDelete) {
    for (const ch of chapters) {
      const versionId = await getActiveVersionId(workspaceId, book, ch);
      switch (cat) {
        case "paragraphBreaks":
          // No textSource filter — getChapterParagraphBreaks loads all sources
          await userDb.delete(paragraphBreaks).where(
            and(eq(paragraphBreaks.workspaceId, workspaceId), eq(paragraphBreaks.versionId, versionId), eq(paragraphBreaks.book, book), eq(paragraphBreaks.chapter, ch))
          );
          break;
        case "characterRefs":
          // No textSource filter — refs are loaded cross-source (getChapterCharacterRefs has no source filter)
          await userDb.delete(characterRefs).where(
            and(eq(characterRefs.workspaceId, workspaceId), eq(characterRefs.versionId, versionId), eq(characterRefs.book, book), eq(characterRefs.chapter, ch))
          );
          break;
        case "speechSections":
          await userDb.delete(speechSections).where(
            and(eq(speechSections.workspaceId, workspaceId), eq(speechSections.versionId, versionId), eq(speechSections.book, book), eq(speechSections.chapter, ch), eq(speechSections.textSource, textSource))
          );
          break;
        case "wordTagRefs":
          // No textSource filter — refs are loaded cross-source (getChapterWordTagRefs has no source filter)
          await userDb.delete(wordTagRefs).where(
            and(eq(wordTagRefs.workspaceId, workspaceId), eq(wordTagRefs.versionId, versionId), eq(wordTagRefs.book, book), eq(wordTagRefs.chapter, ch))
          );
          break;
        case "lineIndents":
          // No textSource filter — getChapterLineIndents loads all sources
          await userDb.delete(lineIndents).where(
            and(eq(lineIndents.workspaceId, workspaceId), eq(lineIndents.versionId, versionId), eq(lineIndents.book, book), eq(lineIndents.chapter, ch))
          );
          break;
        case "wordArrows":
          await userDb.delete(wordArrows).where(
            and(eq(wordArrows.workspaceId, workspaceId), eq(wordArrows.versionId, versionId), eq(wordArrows.book, book), eq(wordArrows.chapter, ch), eq(wordArrows.textSource, textSource))
          );
          break;
        case "wordFormatting":
          // No textSource filter — getChapterWordFormatting loads all sources
          await userDb.delete(wordFormatting).where(
            and(eq(wordFormatting.workspaceId, workspaceId), eq(wordFormatting.versionId, versionId), eq(wordFormatting.book, book), eq(wordFormatting.chapter, ch))
          );
          break;
        case "rstRelations":
          await userDb.delete(rstRelations).where(
            and(eq(rstRelations.workspaceId, workspaceId), eq(rstRelations.versionId, versionId), eq(rstRelations.book, book), eq(rstRelations.chapter, ch), eq(rstRelations.textSource, textSource))
          );
          break;
        case "lineGroups":
          await userDb.delete(lineGroups).where(
            and(eq(lineGroups.workspaceId, workspaceId), eq(lineGroups.versionId, versionId), eq(lineGroups.book, book), eq(lineGroups.chapter, ch), eq(lineGroups.textSource, textSource))
          );
          break;
        case "lineAnnotations":
          await userDb.delete(lineAnnotations).where(
            and(eq(lineAnnotations.workspaceId, workspaceId), eq(lineAnnotations.versionId, versionId), eq(lineAnnotations.book, book), eq(lineAnnotations.chapter, ch), eq(lineAnnotations.textSource, textSource))
          );
          break;
      }
    }
    cleared.push(cat);
  }

  return NextResponse.json({ cleared });
}
