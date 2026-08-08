import { NextRequest, NextResponse } from "next/server";
import { getVersionById, copyVersionAnnotations } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

// POST /api/versions/[id]/copy — copy markup from another version at the same
// locus into this one. Replace semantics per selected feature (see
// copyVersionAnnotations): the destination's existing rows for each selected
// feature are deleted before the source's rows are cloned in.
// Body: { fromVersionId, featureKeys: string[] }
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const toVersionId = parseInt(idStr, 10);
  if (isNaN(toVersionId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: { fromVersionId?: number; featureKeys?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { fromVersionId, featureKeys } = body;
  if (!fromVersionId || !featureKeys?.length) {
    return NextResponse.json({ error: "fromVersionId and featureKeys are required" }, { status: 400 });
  }

  const [toVersion, fromVersion] = await Promise.all([
    getVersionById(toVersionId),
    getVersionById(fromVersionId),
  ]);
  if (!toVersion || !fromVersion) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }
  if (toVersion.workspaceId !== fromVersion.workspaceId || toVersion.book !== fromVersion.book || toVersion.chapter !== fromVersion.chapter) {
    return NextResponse.json({ error: "Versions must be at the same locus" }, { status: 400 });
  }

  const counts = await copyVersionAnnotations(
    toVersion.workspaceId, toVersion.book, toVersion.chapter, fromVersionId, toVersionId, featureKeys
  );
  return NextResponse.json({ counts });
}
