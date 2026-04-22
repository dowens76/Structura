import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { userSqlite, USER_DB_PATH } from "@/lib/db";
import os from "os";
import path from "path";
import fs from "fs";

// ── GET /api/backup ────────────────────────────────────────────────────────────
// Streams a complete copy of user.db using SQLite's online backup API.
// Captures all workspaces, users, annotations, translation text — everything.
export async function GET() {
  const date    = new Date().toISOString().slice(0, 10);
  const tmpPath = path.join(os.tmpdir(), `structura-backup-${Date.now()}.db`);

  try {
    // Checkpoint WAL so the backup includes the latest writes, then snapshot.
    userSqlite.pragma("wal_checkpoint(PASSIVE)");
    await userSqlite.backup(tmpPath);

    const buffer = fs.readFileSync(tmpPath);

    return new Response(buffer, {
      headers: {
        "Content-Type":        "application/x-sqlite3",
        "Content-Disposition": `attachment; filename="structura-${date}.db"`,
      },
    });
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

// Required tables — if any are absent the file isn't a valid Structura backup.
const REQUIRED_TABLES = [
  "users", "workspaces",
  "translations", "translation_verses",
  "paragraph_breaks", "characters", "character_refs", "speech_sections",
  "word_tags", "word_tag_refs", "line_indents", "scene_breaks",
  "passages", "clause_relationships", "rst_relations", "word_arrows",
  "line_annotations", "rst_custom_types", "notes", "word_formatting",
  "constituent_labels", "word_datasets", "word_dataset_entries",
];

// ── POST /api/backup ───────────────────────────────────────────────────────────
// Accepts a multipart form upload of a .db file. Validates it is a Structura
// backup, then atomically replaces all data in user.db via ATTACH + a single
// transaction. All 20 user tables are covered automatically.
export async function POST(request: NextRequest) {
  let tmpPath: string | null = null;
  let restoreDb: Database.Database | null = null;

  try {
    // ── 1. Read the uploaded file ───────────────────────────────────────────
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // ── 2. Validate SQLite magic bytes ──────────────────────────────────────
    const MAGIC = "SQLite format 3\x00";
    if (buffer.length < 16 || buffer.subarray(0, 16).toString("binary") !== MAGIC) {
      return NextResponse.json(
        { error: "Not a valid SQLite database file." },
        { status: 400 }
      );
    }

    // ── 3. Write to a temp file and validate schema ─────────────────────────
    tmpPath = path.join(os.tmpdir(), `structura-restore-${Date.now()}.db`);
    fs.writeFileSync(tmpPath, buffer);

    restoreDb = new Database(tmpPath, { readonly: true });
    const presentTables = new Set(
      (restoreDb.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
      ).all() as { name: string }[]).map((r) => r.name)
    );

    const missing = REQUIRED_TABLES.filter((t) => !presentTables.has(t));
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `This file is missing ${missing.length} required table(s): ${missing.join(", ")}. ` +
                 "It may be from an incompatible version of Structura.",
        },
        { status: 400 }
      );
    }
    restoreDb.close();
    restoreDb = null;

    // ── 4. Atomically replace all data via ATTACH ───────────────────────────
    // Escape any single-quotes in the path (safety for the ATTACH statement).
    const safeTmpPath = tmpPath.replaceAll("'", "''");

    userSqlite.pragma("foreign_keys = OFF");
    userSqlite.exec(`ATTACH DATABASE '${safeTmpPath}' AS restore_src`);

    try {
      const doRestore = userSqlite.transaction(() => {
        // Delete existing data (FK is OFF so order doesn't matter, but
        // reverse order is clearer intent).
        for (const table of [...REQUIRED_TABLES].reverse()) {
          userSqlite.exec(`DELETE FROM "${table}"`);
        }
        // Insert from the backup, using only columns present in both schemas.
        // This allows restoring from older backups that predate schema additions
        // (e.g. scene_breaks gaining `thematic` / `thematic_letter`): missing
        // columns are omitted from the INSERT and fall back to their DEFAULT values.
        for (const table of REQUIRED_TABLES) {
          const backupCols = new Set(
            (userSqlite.prepare(`PRAGMA restore_src.table_info("${table}")`).all() as { name: string }[])
              .map((r) => r.name)
          );
          const currentCols = (
            userSqlite.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]
          ).map((r) => r.name);
          const shared  = currentCols.filter((c) => backupCols.has(c));
          const colList = shared.map((c) => `"${c}"`).join(", ");
          userSqlite.exec(
            `INSERT INTO "${table}" (${colList}) SELECT ${colList} FROM restore_src."${table}"`
          );
        }
      });

      doRestore();
    } finally {
      userSqlite.exec("DETACH DATABASE restore_src");
      userSqlite.pragma("foreign_keys = ON");
    }

    return NextResponse.json({ ok: true });

  } catch (err) {
    console.error("[backup restore]", err);
    return NextResponse.json(
      { error: `Restore failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  } finally {
    restoreDb?.close();
    if (tmpPath) try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}
