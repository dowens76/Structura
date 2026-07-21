import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { userDb, userSqlite } from "@/lib/db";
import { wordTags, translations } from "@/lib/db/user-schema";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { getWorkspaceById } from "@/lib/db/queries";
import { resolveWordTagOccurrences } from "@/lib/db/concept-occurrences";
import { loadWordTagColumns } from "@/lib/db/word-tag-columns";

export const dynamic = "force-dynamic";

interface ValueRow {
  column_id: number;
  word_id: string;
  option_id: number | null;
  text_value: string | null;
}

// ── GET /api/word-tags/occurrences?tagName=X&translationId=Y ─────────────────
// Returns every occurrence of a word/concept tag group (by name), with source
// text, the chosen translation's text, and current custom-column cell values.
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const tagName = searchParams.get("tagName");
  const translationIdParam = searchParams.get("translationId");
  const translationId = translationIdParam ? parseInt(translationIdParam) : null;

  if (!tagName) {
    return NextResponse.json({ error: "Missing tagName." }, { status: 400 });
  }

  const matchingTags = await userDb
    .select()
    .from(wordTags)
    .where(and(eq(wordTags.workspaceId, workspaceId), eq(wordTags.name, tagName)));

  if (matchingTags.length === 0) {
    return NextResponse.json({ error: "Tag not found." }, { status: 404 });
  }

  const tagIds = matchingTags.map((t) => t.id);
  const allTranslations = await userDb.select().from(translations);
  const workspace = await getWorkspaceById(workspaceId);
  const translationOnly = workspace?.translationOnly ?? false;

  const [occurrences, columns] = await Promise.all([
    resolveWordTagOccurrences(tagIds, translationId != null ? { translationIds: [translationId] } : {}),
    Promise.resolve(loadWordTagColumns(workspaceId, tagName)),
  ]);

  const valueRows = columns.length > 0
    ? (userSqlite
        .prepare(
          `SELECT column_id, word_id, option_id, text_value FROM word_tag_column_values
           WHERE column_id IN (${columns.map(() => "?").join(",")})`
        )
        .all(...columns.map((c) => c.id)) as ValueRow[])
    : [];

  const valuesByWord = new Map<string, Map<number, { optionIds: number[]; text: string | null }>>();
  for (const row of valueRows) {
    let byColumn = valuesByWord.get(row.word_id);
    if (!byColumn) { byColumn = new Map(); valuesByWord.set(row.word_id, byColumn); }
    const cell = byColumn.get(row.column_id) ?? { optionIds: [], text: null };
    if (row.option_id != null) cell.optionIds.push(row.option_id);
    if (row.text_value != null) cell.text = row.text_value;
    byColumn.set(row.column_id, cell);
  }

  const first = matchingTags[0];
  const responseOccurrences = occurrences.map((occ) => {
    const byColumn = valuesByWord.get(occ.wordId);
    const values: Record<number, { optionIds: number[]; text: string | null }> = {};
    for (const col of columns) {
      values[col.id] = byColumn?.get(col.id) ?? { optionIds: [], text: null };
    }
    return {
      wordId: occ.wordId,
      book: occ.book,
      chapter: occ.chapter,
      verse: occ.verse,
      reference: occ.reference,
      sourceText: occ.sourceText,
      translationText: translationId != null ? (occ.translationTexts.get(translationId) ?? "") : "",
      values,
    };
  });

  return NextResponse.json({
    tag: {
      name: first.name,
      type: first.type,
      color: first.color,
      books: [...new Set(matchingTags.map((t) => t.book))],
    },
    translationOnly,
    translations: allTranslations.map((t) => ({ id: t.id, abbreviation: t.abbreviation, name: t.name })),
    columns,
    occurrences: responseOccurrences,
  });
}
