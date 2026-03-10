"use client";

import { useRef, useState } from "react";

type RestoreStatus =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "success"; counts: Record<string, number> }
  | { type: "error"; message: string };

export default function BackupPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [status, setStatus] = useState<RestoreStatus>({ type: "idle" });
  const [confirmed, setConfirmed] = useState(false);

  async function handleRestore() {
    if (!selectedFile || !confirmed || status.type === "loading") return;
    setStatus({ type: "loading" });

    let text: string;
    try {
      text = await selectedFile.text();
    } catch {
      setStatus({ type: "error", message: "Failed to read the selected file." });
      return;
    }

    let backup: unknown;
    try {
      backup = JSON.parse(text);
    } catch {
      setStatus({ type: "error", message: "The file is not valid JSON." });
      return;
    }

    try {
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(backup),
      });
      const result = await res.json() as { ok?: boolean; error?: string; counts?: Record<string, number> };
      if (!res.ok || !result.ok) {
        setStatus({ type: "error", message: result.error ?? "Restore failed." });
      } else {
        setStatus({ type: "success", counts: result.counts ?? {} });
        setSelectedFile(null);
        setConfirmed(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    } catch {
      setStatus({ type: "error", message: "Network error — could not reach the server." });
    }
  }

  const sectionStyle = {
    borderColor: "var(--border)",
    backgroundColor: "var(--surface)",
  } as React.CSSProperties;

  return (
    <div className="space-y-6">
      {/* ── Export ───────────────────────────────────────────────────────── */}
      <section className="rounded-xl border p-6" style={sectionStyle}>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--foreground)" }}>
          Export Backup
        </h2>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          Downloads a <code>.json</code> file containing all annotations (paragraph breaks,
          characters, speech sections, word tags, clause relationships, formatting, indents)
          and the full text of any imported translations. Source texts (Hebrew, Greek, LXX)
          are not included — they can be re-imported with the import scripts.
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

      {/* ── Restore ──────────────────────────────────────────────────────── */}
      <section className="rounded-xl border p-6" style={sectionStyle}>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--foreground)" }}>
          Restore from Backup
        </h2>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          Select a previously exported <code>.json</code> backup file to restore. All
          current annotation and translation data will be replaced.
        </p>

        {/* Warning */}
        <div className="mb-4 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <strong>⚠ Warning:</strong> Restoring will permanently replace <em>all</em> current
          annotations and translation data with the contents of the selected file.
          Export a fresh backup first if you want to preserve your current work.
        </div>

        {/* File input */}
        <div className="mb-4">
          <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
            Backup file (.json)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="block text-sm"
            style={{ color: "var(--foreground)" }}
            onChange={(e) => {
              setSelectedFile(e.target.files?.[0] ?? null);
              setStatus({ type: "idle" });
              setConfirmed(false);
            }}
          />
        </div>

        {/* Confirmation checkbox — only shown once a file is selected */}
        {selectedFile && (
          <label
            className="flex items-start gap-2.5 mb-4 text-sm cursor-pointer"
            style={{ color: "var(--foreground)" }}
          >
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 w-4 h-4 shrink-0"
            />
            <span>
              I understand this will <strong>permanently replace</strong> all current data with
              the contents of <strong>{selectedFile.name}</strong>.
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

        {/* Success feedback */}
        {status.type === "success" && (
          <div className="mt-4 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
            <p className="font-medium mb-2">✅ Restore complete — reload the page to see your restored data.</p>
            <ul className="space-y-0.5 opacity-80 text-xs font-mono">
              {Object.entries(status.counts)
                .filter(([, n]) => n > 0)
                .map(([table, count]) => (
                  <li key={table}>
                    {table}: {count.toLocaleString()} rows
                  </li>
                ))}
            </ul>
          </div>
        )}

        {/* Error feedback */}
        {status.type === "error" && (
          <div className="mt-4 rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            ❌ {status.message}
          </div>
        )}
      </section>
    </div>
  );
}
