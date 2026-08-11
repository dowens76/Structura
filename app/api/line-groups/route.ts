import { NextRequest, NextResponse } from "next/server";
import {
  getChapterLineGroups,
  createLineGroup,
  deleteLineGroup,
  deleteLineGroupMember,
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { getActiveVersionId } from "@/lib/versions/activeVersion";

export const dynamic = "force-dynamic";

/** GET ?book=&chapter=&source= → { lineGroups: LineGroup[] } */
export async function GET(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = req.nextUrl;
  const book    = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") ?? "");
  const source  = searchParams.get("source");
  if (!book || isNaN(chapter) || !source)
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  const versionId = await getActiveVersionId(workspaceId, book, chapter);
  const lineGroups = await getChapterLineGroups(book, chapter, source, workspaceId, versionId);
  return NextResponse.json({ lineGroups });
}

/**
 * POST { groupId, members, book, chapter, source }
 *   members: { memberId, sortOrder }[]
 * → { lineGroups: LineGroup[] }
 */
export async function POST(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const body = await req.json();
  const { groupId, members, book, chapter, source } = body as {
    groupId: string;
    members: { memberId: string; sortOrder: number }[];
    book: string;
    chapter: number;
    source: string;
  };
  if (!groupId || !members?.length || !book || !chapter || !source)
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  const versionId = await getActiveVersionId(workspaceId, book, Number(chapter));
  const lineGroupRows = await createLineGroup(
    groupId, members, book, Number(chapter), source, workspaceId, versionId
  );
  return NextResponse.json({ lineGroups: lineGroupRows });
}

/**
 * DELETE { groupId? , id? }
 * - groupId: delete all members of a group
 * - id: delete a single member row
 */
export async function DELETE(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const body = await req.json();
  const { groupId, id } = body as { groupId?: string; id?: number };
  if (groupId) {
    await deleteLineGroup(groupId, workspaceId);
  } else if (id) {
    await deleteLineGroupMember(Number(id));
  } else {
    return NextResponse.json({ error: "Missing groupId or id" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
