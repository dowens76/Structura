/**
 * lib/backup/executor.ts
 *
 * Pure backup execution and retention logic.
 * No scheduling concerns — import freely from API routes and the scheduler.
 */

import fs from "fs";
import path from "path";
import { userSqlite } from "@/lib/db";
import type { AutoBackupSettings } from "@/lib/db/user-schema";

// ── Filename helpers ──────────────────────────────────────────────────────────

const BACKUP_RE = /^structura-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})\.db$/;

export function formatBackupFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `structura-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.db`
  );
}

export function parseBackupTimestamp(filename: string): Date | null {
  const m = BACKUP_RE.exec(filename);
  if (!m) return null;
  // Reconstruct an ISO string and parse it
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/** List all structura-*.db files in a folder, sorted newest first. */
function listBackupFiles(folderPath: string): Array<{ file: string; ts: Date }> {
  let entries: string[];
  try {
    entries = fs.readdirSync(folderPath);
  } catch {
    return [];
  }
  return entries
    .map((f) => ({ file: f, ts: parseBackupTimestamp(f) }))
    .filter((x): x is { file: string; ts: Date } => x.ts !== null)
    .sort((a, b) => b.ts.getTime() - a.ts.getTime()); // newest first
}

// ── ISO week key (e.g. "2025-W44") ───────────────────────────────────────────

function isoWeekKey(date: Date): string {
  // Copy date to avoid mutation; set to nearest Thursday to get ISO week year
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// ── Retention ─────────────────────────────────────────────────────────────────

export function applyRetention(folderPath: string, settings: AutoBackupSettings): void {
  const files = listBackupFiles(folderPath);
  if (files.length === 0) return;

  let toDelete: string[] = [];

  if (settings.retentionType === "keep_all") {
    return; // nothing to do
  }

  if (settings.retentionType === "keep_n") {
    const keep = settings.retentionCount ?? 10;
    toDelete = files.slice(keep).map((x) => x.file);
  }

  if (settings.retentionType === "smart") {
    const now = Date.now();
    const MS_7D  = 7  * 24 * 3600 * 1000;
    const MS_28D = 28 * 24 * 3600 * 1000;

    const keepSet   = new Set<string>();
    const seenWeeks = new Set<string>();
    const seenMonths = new Set<string>();

    for (const { file, ts } of files) {
      const age = now - ts.getTime();
      if (age <= MS_7D) {
        // Recent: keep all
        keepSet.add(file);
      } else if (age <= MS_28D) {
        // Weekly: one per ISO week (already sorted newest-first, so first seen wins)
        const wk = isoWeekKey(ts);
        if (!seenWeeks.has(wk)) {
          seenWeeks.add(wk);
          keepSet.add(file);
        }
      } else {
        // Monthly: one per calendar month
        const mo = monthKey(ts);
        if (!seenMonths.has(mo)) {
          seenMonths.add(mo);
          keepSet.add(file);
        }
      }
    }

    toDelete = files.filter((x) => !keepSet.has(x.file)).map((x) => x.file);
  }

  for (const file of toDelete) {
    try {
      fs.unlinkSync(path.join(folderPath, file));
    } catch {
      // Best-effort: ignore errors deleting individual files
    }
  }
}

// ── Settings persistence (raw SQL to avoid circular imports) ──────────────────

function saveSettingsUpdate(update: Partial<Pick<AutoBackupSettings, "lastBackupAt" | "lastError">>) {
  const fields: string[] = ["updated_at = ?"];
  const values: unknown[] = [new Date().toISOString()];

  if ("lastBackupAt" in update) {
    fields.push("last_backup_at = ?");
    values.push(update.lastBackupAt ?? null);
  }
  if ("lastError" in update) {
    fields.push("last_error = ?");
    values.push(update.lastError ?? null);
  }

  values.push(1); // WHERE id = 1
  userSqlite
    .prepare(`UPDATE auto_backup_settings SET ${fields.join(", ")} WHERE id = 1`)
    .run(...values);
}

// ── Main execution ────────────────────────────────────────────────────────────

export async function executeBackup(
  settings: AutoBackupSettings
): Promise<{ ok: boolean; filename?: string; error?: string }> {
  const { folderPath } = settings;

  if (!folderPath) {
    return { ok: false, error: "No backup folder configured." };
  }

  // Validate folder
  try {
    const stat = fs.statSync(folderPath);
    if (!stat.isDirectory()) {
      return { ok: false, error: `${folderPath} is not a directory.` };
    }
    // Probe write permission
    const probe = path.join(folderPath, `.structura-probe-${Date.now()}`);
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
  } catch (e) {
    const msg = `Folder not accessible: ${e instanceof Error ? e.message : String(e)}`;
    saveSettingsUpdate({ lastError: msg });
    return { ok: false, error: msg };
  }

  const filename = formatBackupFilename(new Date());
  const destPath = path.join(folderPath, filename);

  try {
    userSqlite.pragma("wal_checkpoint(PASSIVE)");
    await userSqlite.backup(destPath);
  } catch (e) {
    const msg = `Backup failed: ${e instanceof Error ? e.message : String(e)}`;
    saveSettingsUpdate({ lastError: msg });
    return { ok: false, error: msg };
  }

  // Success — record timestamp and clear any previous error
  const now = new Date().toISOString();
  saveSettingsUpdate({ lastBackupAt: now, lastError: null });

  // Apply retention policy
  try {
    applyRetention(folderPath, settings);
  } catch {
    // Retention failure does not invalidate the backup itself
  }

  return { ok: true, filename };
}

// ── Interval helper (shared with scheduler and status route) ──────────────────

export function intervalMs(settings: Pick<AutoBackupSettings, "intervalType" | "intervalHours">): number {
  if (settings.intervalType === "weekly")  return 7 * 24 * 3600 * 1000;
  if (settings.intervalType === "custom")  return (settings.intervalHours ?? 24) * 3600 * 1000;
  return 24 * 3600 * 1000; // daily (default)
}
