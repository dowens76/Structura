import { NextRequest, NextResponse } from "next/server";
import {
  getChapterPoetryNotations,
  createPoetryNotation,
  updatePoetryNotation,
  deletePoetryNotation,
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { getActiveVersionId } from "@/lib/versions/activeVersion";

export const dynamic = "force-dynamic";

/** GET ?book=&chapter= → { notations: PoetryNotation[] } — every mark for the chapter
 *  regardless of which text (source or a translation) it's anchored to. */
export async function GET(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(req.url);
  const book    = searchParams.get("book")    ?? "";
  const chapter = parseInt(searchParams.get("chapter") ?? "0", 10);
  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  const notations = await getChapterPoetryNotations(book, chapter, workspaceId, versionId);
  return NextResponse.json({ notations });
}

/** POST { principle, subtype?, direction?, startWordId, endWordId?, startGraphemeIndex?, endGraphemeIndex?, similarityGroupId?, note?, book, chapter, source }
 *   → { notation: PoetryNotation } */
export async function POST(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const body = await req.json();
  const { principle, subtype, direction, startWordId, endWordId, startGraphemeIndex, endGraphemeIndex, similarityGroupId, note, book, chapter, source } = body;
  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  const notation = await createPoetryNotation({
    principle,
    subtype: subtype ?? null,
    direction: direction ?? null,
    startWordId,
    endWordId: endWordId ?? null,
    startGraphemeIndex: startGraphemeIndex ?? null,
    endGraphemeIndex: endGraphemeIndex ?? null,
    similarityGroupId: similarityGroupId ?? null,
    note: note ?? null,
    textSource: source,
    book,
    chapter,
    workspaceId,
    versionId,
  });
  return NextResponse.json({ notation });
}

/** PATCH { id, note?, direction?, startWordId?, endWordId?, startGraphemeIndex?, endGraphemeIndex?, similarityGroupId? } → { notation: PoetryNotation } */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, ...updates } = body as {
    id: number;
    note?: string | null;
    direction?: string | null;
    startWordId?: string;
    endWordId?: string | null;
    startGraphemeIndex?: number | null;
    endGraphemeIndex?: number | null;
    similarityGroupId?: number | null;
  };
  const notation = await updatePoetryNotation(id, updates);
  return NextResponse.json({ notation });
}

/** DELETE { id } → { success: true } */
export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  await deletePoetryNotation(id as number);
  return NextResponse.json({ success: true });
}
