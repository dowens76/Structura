import { NextRequest, NextResponse } from "next/server";
import {
  getVersionsForLocus,
  createVersion,
  copyVersionAnnotations,
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { getActiveVersionId, setActiveVersionId } from "@/lib/versions/activeVersion";

export const dynamic = "force-dynamic";

// GET /api/versions?book=Gen&chapter=1
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const book = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") ?? "", 10);

  if (!book || isNaN(chapter)) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const [versions, activeVersionId] = await Promise.all([
    getVersionsForLocus(workspaceId, book, chapter),
    getActiveVersionId(workspaceId, book, chapter),
  ]);
  return NextResponse.json({ versions, activeVersionId });
}

interface ChapterLocus {
  book: string;
  chapter: number;
}

interface CopySpec {
  featureKey: string;
  fromVersionId: number;
}

// POST /api/versions
// Body: { book, chapter, name?, chapters?: ChapterLocus[], copySpecs?: CopySpec[] }
// `chapters` (Passage view fan-out): create one version per chapter, all
// sharing a groupKey — see renameVersion/deleteVersion for the sibling
// cascade this enables. Copy is only applied at the representative
// (first) chapter — the other fan-out chapters start empty, since there's
// no reliable way to match "the same" source version across chapters
// without a shared groupKey on the source side too.
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: {
    book?: string;
    chapter?: number;
    name?: string | null;
    chapters?: ChapterLocus[];
    copySpecs?: CopySpec[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { book, chapter, name, chapters, copySpecs } = body;
  if (!book || chapter == null) {
    return NextResponse.json({ error: "Missing book or chapter" }, { status: 400 });
  }

  const fanOut = chapters && chapters.length > 1;
  const groupKey = fanOut ? crypto.randomUUID() : null;

  const primary = await createVersion(workspaceId, book, chapter, name, groupKey);

  if (fanOut) {
    for (const loc of chapters!) {
      if (loc.book === book && loc.chapter === chapter) continue;
      await createVersion(workspaceId, loc.book, loc.chapter, primary.name, groupKey);
    }
  }

  if (copySpecs?.length) {
    const byFromVersion = new Map<number, string[]>();
    for (const spec of copySpecs) {
      const list = byFromVersion.get(spec.fromVersionId) ?? [];
      list.push(spec.featureKey);
      byFromVersion.set(spec.fromVersionId, list);
    }
    for (const [fromVersionId, featureKeys] of byFromVersion) {
      await copyVersionAnnotations(workspaceId, book, chapter, fromVersionId, primary.id, featureKeys);
    }
  }

  await setActiveVersionId(workspaceId, book, chapter, primary.id);

  return NextResponse.json({ version: primary });
}
