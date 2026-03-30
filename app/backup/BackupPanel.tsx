"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AutoBackupPanel from "./AutoBackupPanel";

type RestoreStatus =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "success" }
  | { type: "error"; message: string };

export default function BackupPanel() {
  const router        = useRouter();
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [status,       setStatus]       = useState<RestoreStatus>({ type: "idle" });
  const [confirmed,    setConfirmed]    = useState(false);

  async function handleRestore() {
    if (!selectedFile || !confirmed || status.type === "loading") return;
    setStatus({ type: "loading" });

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res    = await fetch("/api/backup", { method: "POST", body: formData });
      const result = await res.json() as { ok?: boolean; error?: string };

      if (!res.ok || !result.ok) {
        setStatus({ type: "error", message: result.error ?? "Restore failed." });
        return;
      }

      setStatus({ type: "success" });
      setSelectedFile(null);
      setConfirmed(false);
      if (fileInputRef.current) fileInputRef.current.value = "";

      // Refresh page data so the restored workspace/user state is visible.
      router.refresh();
    } catch {
      setStatus({ type: "error", message: "Network error — could not reach the server." });
    }
  }

  const surface = { borderColor: "var(--border)", backgroundColor: "var(--surface)" } as React.CSSProperties;

  return (
    <div className="space-y-6">

      {/* ── Export ─────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border p-6" style={surface}>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--foreground)" }}>
          Download Backup
        </h2>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          Downloads a complete copy of your database as a <code>.db</code> file. This
          captures <strong>everything</strong> — all users, all workspaces, all annotations,
          all translation text, and all settings. Source texts (Hebrew, Greek, LXX) are
          stored separately and are not included.
        </p>
        <a
          href="/api/backup"
          download
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: "var(--accent)" }}
        >
          ⬇ Download Backup
        </a>
      </section>

      {/* ── Restore ────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border p-6" style={surface}>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--foreground)" }}>
          Restore from Backup
        </h2>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          Select a <code>.db</code> backup file previously downloaded from Structura.
        </p>

        {/* Warning */}
        <div className="mb-5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-4 py-3 text-sm text-amber-800 dark:text-amber-200 space-y-1">
          <p className="font-semibold">⚠ This will permanently replace all your data.</p>
          <ul className="list-disc list-inside space-y-0.5 opacity-90">
            <li>Every workspace and its annotations will be overwritten</li>
            <li>All translation text will be overwritten</li>
            <li>Your user account details will be overwritten</li>
            <li>This cannot be undone — download a fresh backup first if needed</li>
          </ul>
        </div>

        {/* File input */}
        <div className="mb-4">
          <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
            Backup file (.db)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".db,application/x-sqlite3,application/octet-stream"
            className="block text-sm"
            style={{ color: "var(--foreground)" }}
            onChange={(e) => {
              setSelectedFile(e.target.files?.[0] ?? null);
              setStatus({ type: "idle" });
              setConfirmed(false);
            }}
          />
        </div>

        {/* Confirmation — only shown once a file is selected */}
        {selectedFile && (
          <label
            className="flex items-start gap-2.5 mb-5 text-sm cursor-pointer select-none"
            style={{ color: "var(--foreground)" }}
          >
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 w-4 h-4 shrink-0 accent-red-600"
            />
            <span>
              I understand that restoring <strong>{selectedFile.name}</strong> will{" "}
              <strong>permanently replace all data in every workspace</strong> and cannot
              be undone.
            </span>
          </label>
        )}

        <button
          onClick={handleRestore}
          disabled={!selectedFile || !confirmed || status.type === "loading"}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
          style={{ backgroundColor: "#dc2626" }}
        >
          {status.type === "loading" ? "Restoring…" : "Restore"}
        </button>

        {/* Success */}
        {status.type === "success" && (
          <div className="mt-4 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
            <p className="font-medium">✅ Restore complete.</p>
            <p className="mt-0.5 opacity-80">
              Your data has been replaced. The page has been refreshed — navigate to any
              chapter to continue.
            </p>
          </div>
        )}

        {/* Error */}
        {status.type === "error" && (
          <div className="mt-4 rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            ❌ {status.message}
          </div>
        )}
      </section>

      <AutoBackupPanel />
    </div>
  );
}
