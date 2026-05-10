import { NextRequest, NextResponse } from "next/server";
import { getBookSceneBreaks } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/**
 * GET /api/book-scene-breaks?book=2Sam&source=OSHB
 * Returns all section breaks for the given book + source combination.
 * Used by the Outline pane to load a continuation book's headings.
 */
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const book   = searchParams.get("book");
  const source = searchParams.get("source");

  if (!book || !source) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const breaks = await getBookSceneBreaks(book, source, workspaceId);
  return NextResponse.json({ breaks });
}
