import { NextRequest, NextResponse } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
import { userDb } from "@/lib/db";
import { translations, translationVerses, lineAnnotations } from "@/lib/db/user-schema";
import { getActiveWorkspaceId } from "@/lib/workspace";
import {
  resolveScope,
  chapterCondition,
  filterByChapters,
  filterVersesByChapters,
  type Scope,
  type DataType,
  type OverwritableDataType,
} from "@/lib/workspace-import";

export const dynamic = "force-dynamic";

interface RequestBody {
  sourceWorkspaceId: number;
  scope: Scope;
  dataTypes: DataType[];
}

export interface ConflictInfo {
  /** True when the target workspace already has data of this type in scope. */
  exists: boolean;
  /** Number of existing rows found in the target, for the confirmation message. */
  count: number;
}

/**
 * Reports whether the target (active) workspace already has translation text
 * or clause/paragraph labels (line annotations) for the requested scope, so
 * the UI can ask the user to overwrite or skip before running the actual
 * import (which would otherwise insert duplicate rows — translationVerses in
 * particular has no unique constraint to fall back on).
 */
export async function POST(request: NextRequest) {
  const targetWorkspaceId = await getActiveWorkspaceId();

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sourceWorkspaceId, scope, dataTypes } = body;

  if (
    typeof sourceWorkspaceId !== "number" ||
    !scope ||
    !Array.isArray(dataTypes)
  ) {
    return NextResponse.json(
      { error: "Missing or invalid required fields" },
      { status: 400 }
    );
  }

  const chapters = await resolveScope(scope, sourceWorkspaceId);
  if (chapters.length === 0) {
    return NextResponse.json({ conflicts: {} });
  }

  const conflicts: Partial<Record<OverwritableDataType, ConflictInfo>> = {};

  if (dataTypes.includes("translationVerses")) {
    const chapterNums = [...new Set(chapters.map((c) => c.chapter))];

    let srcVerses = await userDb
      .select({ translationId: translationVerses.translationId, osisRef: translationVerses.osisRef })
      .from(translationVerses)
      .where(
        and(
          eq(translationVerses.workspaceId, sourceWorkspaceId),
          inArray(translationVerses.chapter, chapterNums)
        )
      );
    srcVerses = filterVersesByChapters(srcVerses, chapters);

    if (srcVerses.length > 0) {
      const srcTransIds = [...new Set(srcVerses.map((v) => v.translationId))];
      const srcTranslations = await userDb
        .select()
        .from(translations)
        .where(inArray(translations.id, srcTransIds));
      const abbrs = srcTranslations.map((t) => t.abbreviation);

      let tgtTransIds: number[] = [];
      if (abbrs.length > 0) {
        const tgtTranslations = await userDb
          .select({ id: translations.id })
          .from(translations)
          .where(inArray(translations.abbreviation, abbrs));
        tgtTransIds = tgtTranslations.map((t) => t.id);
      }

      let existingCount = 0;
      if (tgtTransIds.length > 0) {
        let existingRows = await userDb
          .select({ osisRef: translationVerses.osisRef })
          .from(translationVerses)
          .where(
            and(
              eq(translationVerses.workspaceId, targetWorkspaceId),
              inArray(translationVerses.translationId, tgtTransIds),
              inArray(translationVerses.chapter, chapterNums)
            )
          );
        existingRows = filterVersesByChapters(existingRows, chapters);
        existingCount = existingRows.length;
      }

      conflicts.translationVerses = { exists: existingCount > 0, count: existingCount };
    }
  }

  if (dataTypes.includes("lineAnnotations")) {
    const cond = chapterCondition(lineAnnotations, targetWorkspaceId, chapters);
    if (cond) {
      let rows = await userDb.select().from(lineAnnotations).where(cond);
      rows = filterByChapters(rows, chapters);
      conflicts.lineAnnotations = { exists: rows.length > 0, count: rows.length };
    }
  }

  return NextResponse.json({ conflicts });
}
