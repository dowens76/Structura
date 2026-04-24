import { NextRequest, NextResponse } from "next/server";
import { userSqlite } from "@/lib/db";
import { reloadScheduler } from "@/lib/backup/scheduler";
import { readAutoBackupSettings } from "@/lib/backup/executor";
import type { AutoBackupSettings } from "@/lib/db/user-schema";

export const dynamic = "force-dynamic";

const DEFAULTS: Omit<AutoBackupSettings, "id"> = {
  enabled:        false,
  folderPath:     null,
  intervalType:   "daily",
  intervalHours:  24,
  retentionType:  "smart",
  retentionCount: 10,
  lastBackupAt:   null,
  lastError:      null,
  updatedAt:      new Date().toISOString(),
};

function readSettings(): AutoBackupSettings {
  return readAutoBackupSettings() ?? { id: 1, ...DEFAULTS };
}

// ── GET /api/auto-backup/settings ─────────────────────────────────────────────

export async function GET() {
  return NextResponse.json(readSettings());
}

// ── PUT /api/auto-backup/settings ─────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  let body: Partial<AutoBackupSettings>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  // Pick only the fields the client is allowed to set
  const now = new Date().toISOString();
  userSqlite.prepare(`
    INSERT INTO auto_backup_settings
      (id, enabled, folder_path, interval_type, interval_hours,
       retention_type, retention_count, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      enabled         = excluded.enabled,
      folder_path     = excluded.folder_path,
      interval_type   = excluded.interval_type,
      interval_hours  = excluded.interval_hours,
      retention_type  = excluded.retention_type,
      retention_count = excluded.retention_count,
      updated_at      = excluded.updated_at
  `).run(
    body.enabled ? 1 : 0,
    body.folderPath ?? null,
    body.intervalType  ?? "daily",
    body.intervalHours ?? 24,
    body.retentionType  ?? "smart",
    body.retentionCount ?? 10,
    now,
  );

  // Reschedule with the new settings
  reloadScheduler();

  return NextResponse.json(readSettings());
}
