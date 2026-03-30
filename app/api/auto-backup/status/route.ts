import { NextResponse } from "next/server";
import { userSqlite } from "@/lib/db";
import { intervalMs } from "@/lib/backup/executor";
import type { AutoBackupSettings } from "@/lib/db/user-schema";

// ── GET /api/auto-backup/status ───────────────────────────────────────────────
// Returns the current settings row plus a derived nextRunAt timestamp.

export async function GET() {
  const settings = userSqlite
    .prepare("SELECT * FROM auto_backup_settings WHERE id = 1 LIMIT 1")
    .get() as AutoBackupSettings | undefined;

  if (!settings) {
    return NextResponse.json({ settings: null, nextRunAt: null });
  }

  let nextRunAt: string | null = null;
  if (settings.enabled && settings.folderPath && settings.lastBackupAt) {
    const ms       = intervalMs(settings);
    const nextTime = new Date(settings.lastBackupAt).getTime() + ms;
    nextRunAt = new Date(nextTime).toISOString();
  }

  return NextResponse.json({ settings, nextRunAt });
}
