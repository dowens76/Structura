import { NextRequest, NextResponse } from "next/server";
import { executeBackup, readAutoBackupSettings } from "@/lib/backup/executor";
import type { AutoBackupSettings } from "@/lib/db/user-schema";

// ── POST /api/auto-backup/run ─────────────────────────────────────────────────
// Immediately executes one backup.
//
// The client may send current form values in the request body so that the backup
// runs with unsaved settings (e.g. a freshly-browsed folder path).  Any field
// omitted from the body falls back to the saved DB value.

export async function POST(request: NextRequest) {
  // Parse optional overrides from the client (current UI form state).
  let overrides: { folderPath?: string | null; retentionType?: string; retentionCount?: number } = {};
  try { overrides = await request.json(); } catch { /* body is optional */ }

  const dbSettings = readAutoBackupSettings();

  const folderPath = overrides.folderPath ?? dbSettings?.folderPath ?? null;
  if (!folderPath) {
    return NextResponse.json(
      { error: "No backup folder is configured." },
      { status: 400 }
    );
  }

  // Build effective settings for this run, merging UI overrides over DB values.
  const base = dbSettings ?? {
    id: 1, enabled: true,
    folderPath: null, intervalType: "daily", intervalHours: 24,
    retentionType: "smart", retentionCount: 10,
    lastBackupAt: null, lastError: null, updatedAt: new Date().toISOString(),
  };
  const effectiveSettings: AutoBackupSettings = {
    ...base,
    folderPath,
    retentionType:  (overrides.retentionType  ?? base.retentionType)  as AutoBackupSettings["retentionType"],
    retentionCount:  overrides.retentionCount  ?? base.retentionCount,
  };

  try {
    const result = await executeBackup(effectiveSettings);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ ok: true, filename: result.filename });
  } catch (err) {
    console.error("[auto-backup/run] Unhandled error:", err);
    return NextResponse.json(
      { error: `Unexpected server error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
