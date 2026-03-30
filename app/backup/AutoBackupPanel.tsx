"use client";

import { useEffect, useRef, useState } from "react";
import type { AutoBackupSettings } from "@/lib/db/user-schema";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StatusResponse {
  settings: AutoBackupSettings | null;
  nextRunAt: string | null;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";
type RunStatus  = "idle" | "running" | "done" | "error";
type PathStatus = "idle" | "checking" | "ok" | "error";

// ── Relative-time helper ──────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const abs  = Math.abs(diff);
  const future = diff < 0;
  const pfx  = future ? "in " : "";
  const sfx  = future ? ""    : " ago";

  if (abs < 60_000)                  return future ? "less than a minute" : "just now";
  if (abs < 3_600_000)               return `${pfx}${Math.round(abs / 60_000)} min${sfx}`;
  if (abs < 86_400_000)              return `${pfx}${Math.round(abs / 3_600_000)} hr${sfx}`;
  return `${pfx}${Math.round(abs / 86_400_000)} day${sfx}`;
}

// ── Default local state ───────────────────────────────────────────────────────

const EMPTY: Omit<AutoBackupSettings, "id" | "lastBackupAt" | "lastError" | "updatedAt"> = {
  enabled:        false,
  folderPath:     null,
  intervalType:   "daily",
  intervalHours:  24,
  retentionType:  "smart",
  retentionCount: 10,
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function AutoBackupPanel() {
  const [loaded,   setLoaded]   = useState(false);
  const [settings, setSettings] = useState<AutoBackupSettings | null>(null);
  const [nextRunAt, setNextRunAt] = useState<string | null>(null);

  // Editable form state — kept separate from server state until Save
  const [enabled,        setEnabled]        = useState(false);
  const [folderPath,     setFolderPath]      = useState("");
  const [intervalType,   setIntervalType]    = useState<"daily" | "weekly" | "custom">("daily");
  const [intervalHours,  setIntervalHours]   = useState(24);
  const [retentionType,  setRetentionType]   = useState<"keep_all" | "keep_n" | "smart">("smart");
  const [retentionCount, setRetentionCount]  = useState(10);

  const [saveStatus,  setSaveStatus]  = useState<SaveStatus>("idle");
  const [saveError,   setSaveError]   = useState("");
  const [runStatus,   setRunStatus]   = useState<RunStatus>("idle");
  const [runMsg,      setRunMsg]      = useState("");
  const [pathStatus,  setPathStatus]  = useState<PathStatus>("idle");
  const [pathError,   setPathError]   = useState("");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch status ────────────────────────────────────────────────────────────

  async function fetchStatus() {
    try {
      const res  = await fetch("/api/auto-backup/status");
      const data = await res.json() as StatusResponse;
      setSettings(data.settings);
      setNextRunAt(data.nextRunAt);

      if (!loaded && data.settings) {
        // Populate form on first load
        setEnabled(data.settings.enabled);
        setFolderPath(data.settings.folderPath ?? "");
        setIntervalType((data.settings.intervalType as typeof intervalType) ?? "daily");
        setIntervalHours(data.settings.intervalHours ?? 24);
        setRetentionType((data.settings.retentionType as typeof retentionType) ?? "smart");
        setRetentionCount(data.settings.retentionCount ?? 10);
      }
    } catch { /* ignore */ }
    setLoaded(true);
  }

  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 30_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Validate path ───────────────────────────────────────────────────────────

  async function validatePath() {
    if (!folderPath.trim()) return;
    setPathStatus("checking");
    setPathError("");
    try {
      const res    = await fetch("/api/auto-backup/validate-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folderPath.trim() }),
      });
      const result = await res.json() as { ok: boolean; error?: string };
      if (result.ok) {
        setPathStatus("ok");
      } else {
        setPathStatus("error");
        setPathError(result.error ?? "Invalid path.");
      }
    } catch {
      setPathStatus("error");
      setPathError("Could not reach the server.");
    }
  }

  // ── Save settings ───────────────────────────────────────────────────────────

  async function handleSave() {
    setSaveStatus("saving");
    setSaveError("");
    try {
      const res    = await fetch("/api/auto-backup/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          folderPath: folderPath.trim() || null,
          intervalType,
          intervalHours,
          retentionType,
          retentionCount,
        }),
      });
      const result = await res.json() as AutoBackupSettings & { error?: string };
      if (!res.ok) {
        setSaveStatus("error");
        setSaveError(result.error ?? "Save failed.");
        return;
      }
      setSettings(result);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 3000);
      fetchStatus();
    } catch {
      setSaveStatus("error");
      setSaveError("Network error.");
    }
  }

  // ── Run now ─────────────────────────────────────────────────────────────────

  async function handleRunNow() {
    setRunStatus("running");
    setRunMsg("");
    try {
      const res    = await fetch("/api/auto-backup/run", { method: "POST" });
      const result = await res.json() as { ok?: boolean; filename?: string; error?: string };
      if (result.ok) {
        setRunStatus("done");
        setRunMsg(result.filename ?? "Backup complete.");
        fetchStatus();
      } else {
        setRunStatus("error");
        setRunMsg(result.error ?? "Backup failed.");
      }
    } catch {
      setRunStatus("error");
      setRunMsg("Network error.");
    }
    setTimeout(() => setRunStatus("idle"), 8000);
  }

  // ── Styles ──────────────────────────────────────────────────────────────────

  const surface = {
    borderColor: "var(--border)",
    backgroundColor: "var(--surface)",
  } as React.CSSProperties;

  const mutedStyle = { color: "var(--text-muted)" } as React.CSSProperties;

  if (!loaded) return null; // avoid layout shift while fetching

  const lastError = settings?.lastError;
  const lastBackupAt = settings?.lastBackupAt;
  const canRunNow = enabled && !!folderPath.trim();

  return (
    <section className="rounded-xl border p-6" style={surface}>
      <h2 className="text-base font-semibold mb-0.5" style={{ color: "var(--foreground)" }}>
        Automatic Backups
      </h2>
      <p className="text-sm mb-5" style={mutedStyle}>
        Saves a copy of your database to a local folder on a schedule.
        Backups only run while the app is open.
      </p>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      {lastError && (
        <div className="mb-4 rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
          <span className="font-semibold">Last backup failed:</span> {lastError}
        </div>
      )}

      {/* ── Status row ───────────────────────────────────────────────────── */}
      {enabled && lastBackupAt && !lastError && (
        <div className="mb-4 text-xs flex gap-4" style={mutedStyle}>
          <span>Last backup: <strong>{relativeTime(lastBackupAt)}</strong></span>
          {nextRunAt && (
            <span>Next backup: <strong>{relativeTime(nextRunAt)}</strong></span>
          )}
        </div>
      )}

      {/* ── Enable toggle ────────────────────────────────────────────────── */}
      <label className="flex items-center gap-2.5 mb-5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="w-4 h-4"
          style={{ accentColor: "var(--accent)" }}
        />
        <span className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
          Enable automatic backups
        </span>
      </label>

      {/* ── Settings (shown only when enabled) ──────────────────────────── */}
      {enabled && (
        <div className="space-y-5 pl-6 border-l-2" style={{ borderColor: "var(--border)" }}>

          {/* Folder path */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={mutedStyle}>
              Backup folder
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={folderPath}
                onChange={(e) => { setFolderPath(e.target.value); setPathStatus("idle"); }}
                placeholder="/Users/you/Backups/Structura"
                className="flex-1 rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2"
                style={{
                  borderColor: "var(--border)",
                  backgroundColor: "var(--surface)",
                  color: "var(--foreground)",
                }}
              />
              <button
                onClick={validatePath}
                disabled={!folderPath.trim() || pathStatus === "checking"}
                className="px-3 py-1.5 rounded-md border text-xs font-medium transition-opacity disabled:opacity-40"
                style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
              >
                {pathStatus === "checking" ? "Checking…" : "Check"}
              </button>
            </div>
            {pathStatus === "ok" && (
              <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">✓ Folder is writable</p>
            )}
            {pathStatus === "error" && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">✗ {pathError}</p>
            )}
            <p className="mt-1 text-xs" style={mutedStyle}>
              Enter an absolute path on this machine. The folder must already exist.
            </p>
          </div>

          {/* Interval */}
          <div>
            <label className="block text-xs font-medium mb-2" style={mutedStyle}>
              Backup interval
            </label>
            <div className="flex flex-wrap gap-4 text-sm">
              {(["daily", "weekly", "custom"] as const).map((v) => (
                <label key={v} className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="interval"
                    value={v}
                    checked={intervalType === v}
                    onChange={() => setIntervalType(v)}
                    style={{ accentColor: "var(--accent)" }}
                  />
                  <span style={{ color: "var(--foreground)" }}>
                    {v === "daily" ? "Daily" : v === "weekly" ? "Weekly" : "Custom"}
                  </span>
                </label>
              ))}
            </div>
            {intervalType === "custom" && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={intervalHours}
                  onChange={(e) => setIntervalHours(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-20 rounded-md border px-2 py-1 text-sm outline-none"
                  style={{
                    borderColor: "var(--border)",
                    backgroundColor: "var(--surface)",
                    color: "var(--foreground)",
                  }}
                />
                <span className="text-sm" style={mutedStyle}>hours</span>
              </div>
            )}
          </div>

          {/* Retention */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={mutedStyle}>
              Retention policy
            </label>
            <select
              value={retentionType}
              onChange={(e) => setRetentionType(e.target.value as typeof retentionType)}
              className="rounded-md border px-2 py-1.5 text-sm outline-none"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface)",
                color: "var(--foreground)",
              }}
            >
              <option value="keep_all">Keep all backups</option>
              <option value="keep_n">Keep N most recent</option>
              <option value="smart">Smart — tiered retention</option>
            </select>

            {retentionType === "keep_n" && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-sm" style={mutedStyle}>Keep</span>
                <input
                  type="number"
                  min={1}
                  max={9999}
                  value={retentionCount}
                  onChange={(e) => setRetentionCount(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-20 rounded-md border px-2 py-1 text-sm outline-none"
                  style={{
                    borderColor: "var(--border)",
                    backgroundColor: "var(--surface)",
                    color: "var(--foreground)",
                  }}
                />
                <span className="text-sm" style={mutedStyle}>most recent backups</span>
              </div>
            )}

            {retentionType === "smart" && (
              <p className="mt-1.5 text-xs leading-relaxed" style={mutedStyle}>
                Keeps all backups from the last 7 days, one per week for the
                last month, and one per month beyond that.
              </p>
            )}
          </div>

          {/* Action row */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              onClick={handleSave}
              disabled={saveStatus === "saving"}
              className="px-4 py-1.5 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-50"
              style={{ backgroundColor: "var(--accent)" }}
            >
              {saveStatus === "saving" ? "Saving…" : "Save settings"}
            </button>

            <button
              onClick={handleRunNow}
              disabled={!canRunNow || runStatus === "running"}
              className="px-4 py-1.5 rounded-lg border text-sm font-medium transition-opacity disabled:opacity-40"
              style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
            >
              {runStatus === "running" ? "Running…" : "Run backup now"}
            </button>
          </div>

          {/* Save feedback */}
          {saveStatus === "saved" && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">✓ Settings saved.</p>
          )}
          {saveStatus === "error" && (
            <p className="text-xs text-red-600 dark:text-red-400">✗ {saveError}</p>
          )}

          {/* Run feedback */}
          {runStatus === "done" && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              ✓ Backup complete: {runMsg}
            </p>
          )}
          {runStatus === "error" && (
            <p className="text-xs text-red-600 dark:text-red-400">✗ {runMsg}</p>
          )}
        </div>
      )}
    </section>
  );
}
