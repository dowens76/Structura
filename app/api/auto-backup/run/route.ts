import { NextResponse } from "next/server";
import { userSqlite } from "@/lib/db";
import { executeBackup } from "@/lib/backup/executor";
import type { AutoBackupSettings } from "@/lib/db/user-schema";

// ── POST /api/auto-backup/run ─────────────────────────────────────────────────
// Immediately executes one backup using the current settings.

export async function POST() {
  const settings = userSqlite
    .prepare("SELECT * FROM auto_backup_settings WHERE id = 1 LIMIT 1")
    .get() as AutoBackupSettings | undefined;

  if (!settings) {
    return NextResponse.json(
      { error: "Auto-backup is not configured yet." },
      { status: 400 }
    );
  }

  if (!settings.folderPath) {
    return NextResponse.json(
      { error: "No backup folder is configured." },
      { status: 400 }
    );
  }

  const result = await executeBackup(settings);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, filename: result.filename });
}
