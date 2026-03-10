import { NextRequest, NextResponse } from "next/server";
import {
  getChapterClauseRelationships,
  createClauseRelationship,
  deleteClauseRelationship,
} from "@/lib/db/queries";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const book    = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") ?? "");
  const source  = searchParams.get("source");
  if (!book || isNaN(chapter) || !source)
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  const relationships = await getChapterClauseRelationships(book, chapter, source);
  return NextResponse.json({ relationships });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { fromSegWordId, toSegWordId, relType, book, chapter, source } = body;
  if (!fromSegWordId || !toSegWordId || !relType || !book || !chapter || !source)
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  const relationship = await createClauseRelationship(
    fromSegWordId, toSegWordId, relType, book, Number(chapter), source
  );
  return NextResponse.json({ relationship });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const { id } = body;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await deleteClauseRelationship(Number(id));
  return NextResponse.json({ ok: true });
}
