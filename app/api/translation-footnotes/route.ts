import { NextRequest, NextResponse } from "next/server";
import {
  getChapterTranslationFootnotes,
  upsertTranslationFootnote,
  updateTranslationFootnote,
  deleteTranslationFootnote,
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** GET ?translationId=&book=&chapter= → { footnotes: TranslationFootnote[] } */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const translationId = parseInt(searchParams.get("translationId") ?? "0", 10);
  const book          = searchParams.get("book")    ?? "";
  const chapter       = parseInt(searchParams.get("chapter") ?? "0", 10);
  const footnotes = await getChapterTranslationFootnotes(translationId, book, chapter);
  return NextResponse.json({ footnotes });
}

/** POST { translationId, osisRef, type, content, wordIndex, book, chapter, verse }
 *   → { footnote: TranslationFootnote } */
export async function POST(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { translationId, osisRef, type, content, wordIndex, book, chapter, verse } = await req.json();
  const footnote = await upsertTranslationFootnote(
    workspaceId, translationId, osisRef, type ?? "f", content, wordIndex ?? 0,
    book, chapter, verse,
  );
  return NextResponse.json({ footnote });
}

/** PATCH { id, content, type? } → { success: true } */
export async function PATCH(req: NextRequest) {
  const { id, content, type } = await req.json();
  await updateTranslationFootnote(id as number, content as string, type as string | undefined);
  return NextResponse.json({ success: true });
}

/** DELETE { id } → { success: true } */
export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  await deleteTranslationFootnote(id as number);
  return NextResponse.json({ success: true });
}
