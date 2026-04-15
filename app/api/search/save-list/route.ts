import { NextRequest, NextResponse } from "next/server";
import { userDb } from "@/lib/db";
import { wordTags, wordTagRefs } from "@/lib/db/user-schema";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { bulkInsertWordTagRefs } from "@/lib/db/queries";

interface WordRef {
  wordId: string;
  book: string;
  chapter: number;
  textSource: string;
}

// POST /api/search/save-list
// Body: { name, color, wordRefs: WordRef[] }
// Creates a corpus-wide wordTag (book='*') and bulk-inserts refs.
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();

  let body: { name?: string; color?: string; wordRefs?: WordRef[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, color, wordRefs } = body;
  if (!name || !color || !Array.isArray(wordRefs) || wordRefs.length === 0) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Create a corpus-wide tag (book='*', type='search')
  const [tag] = await userDb
    .insert(wordTags)
    .values({ name, color, type: "search", book: "*", workspaceId })
    .returning({ id: wordTags.id });

  if (!tag) {
    return NextResponse.json({ error: "Failed to create tag" }, { status: 500 });
  }

  const { inserted } = await bulkInsertWordTagRefs(tag.id, wordRefs, workspaceId);
  const skipped = wordRefs.length - inserted;

  return NextResponse.json({ tagId: tag.id, tagged: inserted, skipped });
}
