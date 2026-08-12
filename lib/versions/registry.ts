/**
 * The 14 chapter-scoped markup tables that a "version" can hold an
 * independent copy of. Drives the checkbox lists in the Create/Manage
 * version dialogs and the generic same-workspace copy in
 * lib/db/queries.ts's copyVersionAnnotations(). Every table listed here must
 * have workspaceId, versionId, book, and chapter columns (see
 * lib/db/user-schema.ts) — that shared shape is what lets one copy routine
 * work for all of them without a per-table switch statement.
 *
 * Deliberately excluded: translations (shared across workspaces, must stay
 * shared across versions too), bookmarks (navigation, not markup), and
 * workspace-level taxonomy tables like characters/wordTags/passages (the
 * definitions are shared across versions — only the instance rows that
 * reference them, e.g. characterRefs/wordTagRefs, are versioned).
 */
import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  paragraphBreaks,
  characterRefs,
  speechSections,
  wordTagRefs,
  lineIndents,
  sceneBreaks,
  rstRelations,
  lineGroups,
  wordArrows,
  lineAnnotations,
  wordFormatting,
  textCriticalMarks,
  poetryNotations,
  poetryLineBracketExclusions,
} from "@/lib/db/user-schema";
import { VERSIONABLE_FEATURE_LABELS } from "./featureLabels";

export interface VersionableTable extends SQLiteTable {
  id: AnySQLiteColumn;
  workspaceId: AnySQLiteColumn;
  versionId: AnySQLiteColumn;
  book: AnySQLiteColumn;
  chapter: AnySQLiteColumn;
}

export interface VersionableFeature {
  key: string;
  label: string;
  table: VersionableTable;
}

const TABLES_BY_KEY: Record<string, VersionableTable> = {
  paragraphBreaks,
  characterRefs,
  speechSections,
  wordTagRefs,
  lineIndents,
  sceneBreaks,
  rstRelations,
  lineGroups,
  wordArrows,
  lineAnnotations,
  wordFormatting,
  textCriticalMarks,
  poetryNotations,
  poetryLineBracketExclusions,
};

export const VERSIONABLE_FEATURES: VersionableFeature[] = VERSIONABLE_FEATURE_LABELS.map(({ key, label }) => ({
  key,
  label,
  table: TABLES_BY_KEY[key],
}));
