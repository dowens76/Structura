import { NextResponse } from "next/server";
import { intervalMs, readAutoBackupSettings } from "@/lib/backup/executor";

// ── GET /api/auto-backup/status ───────────────────────────────────────────────
// Returns the current settings row plus a derived nextRunAt timestamp.

export async function GET() {
  const settings = readAutoBackupSettings();

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
