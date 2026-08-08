import { NextRequest, NextResponse } from "next/server";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { setActiveVersionId } from "@/lib/versions/activeVersion";

export const dynamic = "force-dynamic";

// POST /api/versions/select — set the active version for a (book, chapter) locus.
// Body: { book, chapter, versionId }
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { book?: string; chapter?: number; versionId?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { book, chapter, versionId } = body;
  if (!book || chapter == null || versionId == null) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  await setActiveVersionId(workspaceId, book, chapter, versionId);
  return NextResponse.json({ ok: true });
}
