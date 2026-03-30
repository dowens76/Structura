/**
 * lib/backup/scheduler.ts
 *
 * setTimeout-based backup scheduler. Imported once by instrumentation.ts at
 * server startup; also exports reloadScheduler() for the settings API route
 * to call when the user changes their configuration.
 *
 * Uses a globalThis flag to prevent duplicate schedulers under Next.js dev-mode
 * hot-reload or any other scenario where this module is evaluated more than once.
 */

import { userSqlite } from "@/lib/db";
import { executeBackup, intervalMs } from "@/lib/backup/executor";
import type { AutoBackupSettings } from "@/lib/db/user-schema";

declare global {
  // eslint-disable-next-line no-var
  var __backupSchedulerStarted: boolean | undefined;
}

let _timerId: NodeJS.Timeout | null = null;

// ── Raw settings read (avoids Drizzle import — executor already imports userSqlite) ──

function readSettings(): AutoBackupSettings | null {
  try {
    const row = userSqlite
      .prepare("SELECT * FROM auto_backup_settings WHERE id = 1 LIMIT 1")
      .get() as AutoBackupSettings | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

// ── Schedule next run ─────────────────────────────────────────────────────────

function scheduleNext(ms: number, settings: AutoBackupSettings): void {
  _timerId = setTimeout(async () => {
    // Re-read settings at run time — they may have changed since scheduling
    const current = readSettings();
    if (!current?.enabled || !current.folderPath) {
      // Disabled or unconfigured — do nothing; reloadScheduler() will restart if re-enabled
      return;
    }

    console.log("[auto-backup] Running scheduled backup…");
    const result = await executeBackup(current);
    if (result.ok) {
      console.log(`[auto-backup] Backup complete: ${result.filename}`);
    } else {
      console.warn(`[auto-backup] Backup failed: ${result.error}`);
    }

    // Re-read again after execution (lastBackupAt is now updated)
    const next = readSettings();
    if (next?.enabled && next.folderPath) {
      scheduleNext(intervalMs(next), next);
    }
  }, ms);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startScheduler(): void {
  const settings = readSettings();
  if (!settings?.enabled || !settings.folderPath) {
    console.log("[auto-backup] Scheduler idle (disabled or no folder configured).");
    return;
  }

  const ms = intervalMs(settings);
  let msUntilNext: number;

  if (settings.lastBackupAt) {
    const elapsed = Date.now() - new Date(settings.lastBackupAt).getTime();
    msUntilNext = Math.max(0, ms - elapsed);
  } else {
    // Never backed up — run after a short grace period on startup
    msUntilNext = 5_000;
  }

  const humanMs =
    msUntilNext < 60_000
      ? `${Math.round(msUntilNext / 1000)}s`
      : `${Math.round(msUntilNext / 60_000)}m`;

  console.log(`[auto-backup] Scheduler started. Next backup in ${humanMs}.`);
  scheduleNext(msUntilNext, settings);
}

/** Cancel the pending timer and restart with current settings from the DB.
 *  Called by PUT /api/auto-backup/settings after saving changes. */
export function reloadScheduler(): void {
  if (_timerId !== null) {
    clearTimeout(_timerId);
    _timerId = null;
  }
  startScheduler();
}

// ── Module-level init (runs when instrumentation.ts imports this module) ──────

if (!globalThis.__backupSchedulerStarted) {
  globalThis.__backupSchedulerStarted = true;
  startScheduler();
}
