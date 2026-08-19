import { NextRequest, NextResponse } from "next/server";
import {
  getChapterLineAnnotations,
  createLineAnnotation,
  updateLineAnnotation,
  updateThemeColorForLabel,
  deleteLineAnnotation,
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { getActiveVersionId } from "@/lib/versions/activeVersion";

export const dynamic = "force-dynamic";

/** GET ?book=&chapter=&source= → { annotations: LineAnnotation[] } */
export async function GET(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(req.url);
  const book    = searchParams.get("book")    ?? "";
  const chapter = parseInt(searchParams.get("chapter") ?? "0", 10);
  const source  = searchParams.get("source")  ?? "";
  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  const annotations = await getChapterLineAnnotations(book, chapter, source, workspaceId, versionId);
  return NextResponse.json({ annotations });
}

/** POST { annotType, label, commFunction?, color, description, outOfSequence?, startWordId, endWordId, book, chapter, source }
 *   → { annotation: LineAnnotation } */
export async function POST(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const body = await req.json();
  const { annotType, label, commFunction, color, description, outOfSequence, transitional, startWordId, endWordId, book, chapter, source } = body;
  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  const annotation = await createLineAnnotation(
    annotType,
    label,
    color,
    description ?? null,
    outOfSequence ?? false,
    transitional ?? false,
    startWordId,
    endWordId,
    source,
    book,
    chapter,
    workspaceId,
    versionId,
    commFunction ?? null
  );
  return NextResponse.json({ annotation });
}

/**
 * PATCH { id, annotType?, label?, commFunction?, color?, description?, outOfSequence?, startWordId?, endWordId? }
 *   → { annotation: LineAnnotation, alsoRecolored?: LineAnnotation[] }
 *
 * When a "theme" annotation's color changes, every other instance of that
 * theme (same workspace/version/book/textSource/label, any chapter) is
 * recolored to match — themes are meant to carry one color across every
 * instance, so this keeps that invariant true even after the color has
 * already been picked once. `alsoRecolored` carries the other affected rows
 * so callers can update any of them currently held in local state.
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, ...updates } = body as {
    id: number;
    annotType?: string;
    label?: string;
    commFunction?: string | null;
    color?: string;
    description?: string | null;
    outOfSequence?: boolean;
    transitional?: boolean;
    startWordId?: string;
    endWordId?: string;
  };
  const annotation = await updateLineAnnotation(id, updates);

  let alsoRecolored: Awaited<ReturnType<typeof updateThemeColorForLabel>> = [];
  if (updates.color && annotation.annotType === "theme") {
    const recolored = await updateThemeColorForLabel(
      annotation.workspaceId,
      annotation.versionId,
      annotation.book,
      annotation.textSource,
      annotation.label,
      updates.color
    );
    alsoRecolored = recolored.filter((a) => a.id !== annotation.id);
  }

  return NextResponse.json({ annotation, alsoRecolored });
}

/** DELETE { id } → { success: true } */
export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  await deleteLineAnnotation(id as number);
  return NextResponse.json({ success: true });
}
