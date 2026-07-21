import { userSqlite } from "@/lib/db";

interface ColumnRow {
  id: number;
  tag_name: string;
  name: string;
  type: string;
  sort_order: number;
}

interface OptionRow {
  id: number;
  column_id: number;
  value: string;
  color: string | null;
  sort_order: number;
}

export interface WordTagColumnWithOptions {
  id: number;
  tagName: string;
  name: string;
  type: string;
  sortOrder: number;
  options?: { id: number; value: string; color: string | null; sortOrder: number }[];
}

/** Loads the custom classification columns (+ list-type options) for a concept/word-tag
 *  group, seeding a default "Tags" (list-type) column the first time it's requested. */
export function loadWordTagColumns(workspaceId: number, tagName: string): WordTagColumnWithOptions[] {
  const existing = userSqlite
    .prepare("SELECT id FROM word_tag_columns WHERE workspace_id = ? AND tag_name = ? LIMIT 1")
    .get(workspaceId, tagName);
  if (!existing) {
    userSqlite
      .prepare(
        "INSERT INTO word_tag_columns (workspace_id, tag_name, name, type, sort_order, created_at) VALUES (?, ?, 'Tags', 'list', 0, ?)"
      )
      .run(workspaceId, tagName, new Date().toISOString());
  }

  const columns = userSqlite
    .prepare(
      "SELECT id, tag_name, name, type, sort_order FROM word_tag_columns WHERE workspace_id = ? AND tag_name = ? ORDER BY sort_order, id"
    )
    .all(workspaceId, tagName) as ColumnRow[];

  const options = columns.length > 0
    ? (userSqlite
        .prepare(
          `SELECT id, column_id, value, color, sort_order FROM word_tag_column_options
           WHERE column_id IN (${columns.map(() => "?").join(",")}) ORDER BY sort_order, id`
        )
        .all(...columns.map((c) => c.id)) as OptionRow[])
    : [];
  const optionsByColumn = new Map<number, OptionRow[]>();
  for (const o of options) {
    const arr = optionsByColumn.get(o.column_id) ?? [];
    arr.push(o);
    optionsByColumn.set(o.column_id, arr);
  }

  return columns.map((c) => ({
    id: c.id,
    tagName: c.tag_name,
    name: c.name,
    type: c.type,
    sortOrder: c.sort_order,
    options: c.type === "list"
      ? (optionsByColumn.get(c.id) ?? []).map((o) => ({ id: o.id, value: o.value, color: o.color, sortOrder: o.sort_order }))
      : undefined,
  }));
}
