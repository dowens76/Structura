import { NextRequest, NextResponse } from "next/server";
import {
  getIntertextualLinksForChapter,
  getIntertextualLinksForBook,
  getAllIntertextualLinks,
  createIntertextualLink,
  updateIntertextualLink,
  deleteIntertextualLink,
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = req.nextUrl;
  const scope   = searchParams.get("scope");
  const book    = searchParams.get("book");
  const chapter = searchParams.get("chapter");

  if (scope === "all") {
    const links = await getAllIntertextualLinks(workspaceId);
    return NextResponse.json({ links });
  }

  if (!book) return NextResponse.json({ error: "Missing book" }, { status: 400 });

  if (chapter !== null) {
    const ch = parseInt(chapter);
    if (isNaN(ch)) return NextResponse.json({ error: "Invalid chapter" }, { status: 400 });
    const links = await getIntertextualLinksForChapter(book, ch, workspaceId);
    return NextResponse.json({ links });
  }

  const links = await getIntertextualLinksForBook(book, workspaceId);
  return NextResponse.json({ links });
}

export async function POST(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const body = await req.json();
  const {
    sourceBook, sourceChapter, sourceVerse, sourceEndVerse,
    sourceTextSource, sourceStartWordId, sourceEndWordId,
    targetBook, targetChapter, targetVerse, targetEndVerse,
    targetTextSource, targetStartWordId, targetEndWordId,
    linkType, strength, notes, direction, tags,
  } = body;

  if (
    !sourceBook || sourceChapter == null || sourceVerse == null || !sourceTextSource ||
    !targetBook || targetChapter == null || targetVerse == null || !targetTextSource ||
    !linkType
  ) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const link = await createIntertextualLink(
    {
      sourceBook, sourceChapter: Number(sourceChapter), sourceVerse: Number(sourceVerse),
      sourceEndVerse: sourceEndVerse ?? null,
      sourceTextSource, sourceStartWordId: sourceStartWordId ?? null,
      sourceEndWordId: sourceEndWordId ?? null,
      targetBook, targetChapter: Number(targetChapter), targetVerse: Number(targetVerse),
      targetEndVerse: targetEndVerse ?? null,
      targetTextSource, targetStartWordId: targetStartWordId ?? null,
      targetEndWordId: targetEndWordId ?? null,
      linkType, strength: strength ?? 3, notes: notes ?? null,
      direction: direction ?? "source_to_target",
      tags: Array.isArray(tags) ? JSON.stringify(tags) : "[]",
    },
    workspaceId
  );
  return NextResponse.json({ link });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, ...patch } = body;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const allowed = ["linkType","strength","notes","direction","tags",
    "sourceBook","sourceChapter","sourceVerse","sourceEndVerse","sourceStartWordId","sourceEndWordId",
    "targetBook","targetChapter","targetVerse","targetEndVerse","targetStartWordId","targetEndWordId"];
  const filteredPatch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in patch) filteredPatch[key] = patch[key];
  }
  if ("tags" in filteredPatch && Array.isArray(filteredPatch.tags)) {
    filteredPatch.tags = JSON.stringify(filteredPatch.tags);
  }

  const link = await updateIntertextualLink(Number(id), filteredPatch);
  return NextResponse.json({ link });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const { id } = body;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await deleteIntertextualLink(Number(id));
  return NextResponse.json({ ok: true });
}
