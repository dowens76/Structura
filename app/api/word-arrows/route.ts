import { NextRequest, NextResponse } from "next/server";
import {
  getChapterWordArrows,
  createWordArrow,
  deleteWordArrow,
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = req.nextUrl;
  const book    = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") ?? "");
  const source  = searchParams.get("source");
  if (!book || isNaN(chapter) || !source)
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  const arrows = await getChapterWordArrows(book, chapter, source, workspaceId);
  return NextResponse.json({ arrows });
}

export async function POST(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const body = await req.json();
  const { fromWordId, toWordId, book, chapter, source, label } = body;
  if (!fromWordId || !toWordId || !book || !chapter || !source)
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  const arrow = await createWordArrow(
    fromWordId, toWordId, book, Number(chapter), source, workspaceId, label ?? undefined
  );
  return NextResponse.json({ arrow });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const { id } = body;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await deleteWordArrow(Number(id));
  return NextResponse.json({ ok: true });
}
