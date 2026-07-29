import { NextRequest, NextResponse } from "next/server";
import {
  getChapterSynopticWordMarks,
  createSynopticWordMark,
  updateSynopticWordMark,
  deleteSynopticWordMark,
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** GET ?book=&chapter=&source= → { marks: SynopticWordMark[] } */
export async function GET(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(req.url);
  const book    = searchParams.get("book")    ?? "";
  const chapter = parseInt(searchParams.get("chapter") ?? "0", 10);
  const source  = searchParams.get("source")  ?? "";
  const marks = await getChapterSynopticWordMarks(book, chapter, source, workspaceId);
  return NextResponse.json({ marks });
}

/** POST { categoryKey, color, startWordId, endWordId, book, chapter, source } → { mark: SynopticWordMark } */
export async function POST(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const body = await req.json();
  const { categoryKey, color, startWordId, endWordId, book, chapter, source } = body;
  const mark = await createSynopticWordMark(
    categoryKey, color, startWordId, endWordId, source, book, chapter, workspaceId
  );
  return NextResponse.json({ mark });
}

/** PATCH { id, categoryKey?, color? } → { mark: SynopticWordMark } */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, ...updates } = body as { id: number; categoryKey?: string; color?: string };
  const mark = await updateSynopticWordMark(id, updates);
  return NextResponse.json({ mark });
}

/** DELETE { id } → { success: true } */
export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  await deleteSynopticWordMark(id as number);
  return NextResponse.json({ success: true });
}
