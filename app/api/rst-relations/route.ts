import { NextRequest, NextResponse } from "next/server";
import {
  getChapterRstRelations,
  createRstRelationGroup,
  deleteRstRelationGroup,
  deleteRstRelation,
  updateRstRelationGroupType,
  updateRstRelationIntersectPoint,
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** GET ?book=&chapter=&source= → { relations: RstRelation[] } */
export async function GET(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = req.nextUrl;
  const book    = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") ?? "");
  const source  = searchParams.get("source");
  if (!book || isNaN(chapter) || !source)
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  const relations = await getChapterRstRelations(book, chapter, source, workspaceId);
  return NextResponse.json({ relations });
}

/**
 * POST { groupId, members, relType, book, chapter, source }
 *   members: { segWordId, role, sortOrder }[]
 * → { relations: RstRelation[] }
 */
export async function POST(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const body = await req.json();
  const { groupId, members, relType, book, chapter, source } = body as {
    groupId: string;
    members: { segWordId: string; role: "nucleus" | "satellite"; sortOrder: number }[];
    relType: string;
    book: string;
    chapter: number;
    source: string;
  };
  if (!groupId || !members?.length || !relType || !book || !chapter || !source)
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  const relations = await createRstRelationGroup(
    groupId, members, relType, book, Number(chapter), source, workspaceId
  );
  return NextResponse.json({ relations });
}

/**
 * PATCH { groupId, relType }        → update relType for all members of a group
 * PATCH { id, intersectPoint }      → update intersectPoint for a single row
 */
export async function PATCH(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const body = await req.json();

  if ("id" in body && "intersectPoint" in body) {
    const { id, intersectPoint } = body as { id: number; intersectPoint: string };
    if (!id || !intersectPoint)
      return NextResponse.json({ error: "Missing id or intersectPoint" }, { status: 400 });
    if (!["start", "mid", "end"].includes(intersectPoint))
      return NextResponse.json({ error: "Invalid intersectPoint" }, { status: 400 });
    await updateRstRelationIntersectPoint(Number(id), intersectPoint as "start" | "mid" | "end");
    return NextResponse.json({ ok: true });
  }

  const { groupId, relType } = body as { groupId: string; relType: string };
  if (!groupId || !relType)
    return NextResponse.json({ error: "Missing groupId or relType" }, { status: 400 });
  await updateRstRelationGroupType(groupId, relType, workspaceId);
  return NextResponse.json({ ok: true });
}

/**
 * DELETE { groupId? , id? }
 * - groupId: delete all members of a group
 * - id: delete a single member
 */
export async function DELETE(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const body = await req.json();
  const { groupId, id } = body as { groupId?: string; id?: number };
  if (groupId) {
    await deleteRstRelationGroup(groupId, workspaceId);
  } else if (id) {
    await deleteRstRelation(Number(id));
  } else {
    return NextResponse.json({ error: "Missing groupId or id" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
