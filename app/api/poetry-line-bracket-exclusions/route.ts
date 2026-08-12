import { NextRequest, NextResponse } from "next/server";
import {
  getChapterPoetryLineBracketExclusions,
  createPoetryLineBracketExclusion,
  deletePoetryLineBracketExclusionByWord,
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { getActiveVersionId } from "@/lib/versions/activeVersion";

export const dynamic = "force-dynamic";

/** GET ?book=&chapter=&source= → { exclusions: PoetryLineBracketExclusion[] } */
export async function GET(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(req.url);
  const book    = searchParams.get("book")    ?? "";
  const chapter = parseInt(searchParams.get("chapter") ?? "0", 10);
  const source  = searchParams.get("source")  ?? "";
  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  const exclusions = await getChapterPoetryLineBracketExclusions(book, chapter, source, workspaceId, versionId);
  return NextResponse.json({ exclusions });
}

/** POST { wordId, book, chapter, source } → { exclusion: PoetryLineBracketExclusion } */
export async function POST(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const body = await req.json();
  const { wordId, book, chapter, source } = body;
  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  const exclusion = await createPoetryLineBracketExclusion({
    wordId, textSource: source, book, chapter, workspaceId, versionId,
  });
  return NextResponse.json({ exclusion });
}

/** DELETE { wordId, book, chapter } → { success: true } */
export async function DELETE(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { wordId, book, chapter } = await req.json();
  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  await deletePoetryLineBracketExclusionByWord(workspaceId, versionId, wordId);
  return NextResponse.json({ success: true });
}
