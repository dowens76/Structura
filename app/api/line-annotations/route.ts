import { NextRequest, NextResponse } from "next/server";
import {
  getChapterLineAnnotations,
  createLineAnnotation,
  updateLineAnnotation,
  deleteLineAnnotation,
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

/** GET ?book=&chapter=&source= → { annotations: LineAnnotation[] } */
export async function GET(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(req.url);
  const book    = searchParams.get("book")    ?? "";
  const chapter = parseInt(searchParams.get("chapter") ?? "0", 10);
  const source  = searchParams.get("source")  ?? "";
  const annotations = await getChapterLineAnnotations(book, chapter, source, workspaceId);
  return NextResponse.json({ annotations });
}

/** POST { annotType, label, color, description, outOfSequence?, startWordId, endWordId, book, chapter, source }
 *   → { annotation: LineAnnotation } */
export async function POST(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const body = await req.json();
  const { annotType, label, color, description, outOfSequence, startWordId, endWordId, book, chapter, source } = body;
  const annotation = await createLineAnnotation(
    annotType,
    label,
    color,
    description ?? null,
    outOfSequence ?? false,
    startWordId,
    endWordId,
    source,
    book,
    chapter,
    workspaceId
  );
  return NextResponse.json({ annotation });
}

/** PATCH { id, label?, color?, description?, outOfSequence?, startWordId?, endWordId? } → { annotation: LineAnnotation } */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, ...updates } = body as {
    id: number;
    label?: string;
    color?: string;
    description?: string | null;
    outOfSequence?: boolean;
    startWordId?: string;
    endWordId?: string;
  };
  const annotation = await updateLineAnnotation(id, updates);
  return NextResponse.json({ annotation });
}

/** DELETE { id } → { success: true } */
export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  await deleteLineAnnotation(id as number);
  return NextResponse.json({ success: true });
}
