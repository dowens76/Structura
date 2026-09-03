import { NextRequest, NextResponse } from "next/server";
import {
  getChapterWordArrows,
  createWordArrow,
  deleteWordArrow,
  updateWordArrow,
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { getActiveVersionId } from "@/lib/versions/activeVersion";

export const dynamic = "force-dynamic";

/** Logs the real error (visible in the Tauri app's captured node-stderr log,
 *  even though the client only ever sees a generic message) and returns a
 *  JSON 500 response instead of letting Next.js's default bare-500 handler
 *  swallow the detail. */
function failedWrite(action: string, e: unknown) {
  console.error(`[word-arrows] ${action} failed:`, e);
  const message = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = req.nextUrl;
  const book    = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") ?? "");
  const source  = searchParams.get("source");
  if (!book || isNaN(chapter) || !source)
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  const arrows = await getChapterWordArrows(book, chapter, source, workspaceId, versionId);
  return NextResponse.json({ arrows });
}

export async function POST(req: NextRequest) {
  try {
    const workspaceId = await getActiveWorkspaceId();
    const body = await req.json();
    const { fromWordId, toWordId, book, chapter, source, label, similarityGroupId, color } = body;
    if (!fromWordId || !toWordId || !book || !chapter || !source)
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    const versionId = await getActiveVersionId(workspaceId, book, Number(chapter));
    const arrow = await createWordArrow(
      fromWordId, toWordId, book, Number(chapter), source, workspaceId, versionId, label ?? undefined, similarityGroupId ?? undefined, color ?? undefined
    );
    return NextResponse.json({ arrow });
  } catch (e) {
    return failedWrite("create", e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, color, midpointDx, midpointDy, midpoint2Dx, midpoint2Dy, fromWordId, toWordId } = body;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const patch: Record<string, unknown> = {};
    if ("color"        in body) patch.color        = color        ?? null;
    if ("midpointDx"   in body) patch.midpointDx   = midpointDx   ?? null;
    if ("midpointDy"   in body) patch.midpointDy   = midpointDy   ?? null;
    if ("midpoint2Dx"  in body) patch.midpoint2Dx  = midpoint2Dx  ?? null;
    if ("midpoint2Dy"  in body) patch.midpoint2Dy  = midpoint2Dy  ?? null;
    if ("fromWordId"   in body) patch.fromWordId   = fromWordId;
    if ("toWordId"     in body) patch.toWordId     = toWordId;
    const arrow = await updateWordArrow(Number(id), patch);
    return NextResponse.json({ arrow });
  } catch (e) {
    return failedWrite("update", e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { id } = body;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    await deleteWordArrow(Number(id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failedWrite("delete", e);
  }
}
