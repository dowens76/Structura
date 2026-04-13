"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AutoBackupPanel from "./AutoBackupPanel";
import { useTranslation } from "@/lib/i18n/LocaleContext";

type RestoreStatus =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "success" }
  | { type: "error"; message: string };

export default function BackupPanel() {
  const { t } = useTranslation();
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
      <header className="mb-8">
        <Link
          href="/"
          className="text-sm text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 mb-4 inline-block transition-colors"
        >
          {t("backup.backLink")}
        </Link>
        <h1 className="text-3xl font-bold mt-2" style={{ color: "var(--foreground)" }}>
          {t("backup.title")}
        </h1>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          {t("backup.description")}
        </p>
      </header>

      {/* ── Export ─────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border p-6" style={surface}>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--foreground)" }}>
          {t("backup.downloadTitle")}
        </h2>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          {t("backup.downloadDesc")}
        </p>
        <a
          href="/api/backup"
          download
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: "var(--accent)" }}
        >
          {t("backup.downloadBtn")}
        </a>
      </section>

      {/* ── Restore ────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border p-6" style={surface}>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--foreground)" }}>
          {t("backup.restoreTitle")}
        </h2>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          {t("backup.restoreDesc")}
        </p>

        {/* Warning */}
        <div className="mb-5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-4 py-3 text-sm text-amber-800 dark:text-amber-200 space-y-1">
          <p className="font-semibold">{t("backup.warningTitle")}</p>
          <ul className="list-disc list-inside space-y-0.5 opacity-90">
            <li>{t("backup.warningItem1")}</li>
            <li>{t("backup.warningItem2")}</li>
            <li>{t("backup.warningItem3")}</li>
            <li>{t("backup.warningItem4")}</li>
          </ul>
        </div>

        {/* File input */}
        <div className="mb-4">
          <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
            {t("backup.fileLabel")}
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
              {t("backup.confirmRestore", { filename: selectedFile.name })}
            </span>
          </label>
        )}

        <button
          onClick={handleRestore}
          disabled={!selectedFile || !confirmed || status.type === "loading"}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
          style={{ backgroundColor: "#dc2626" }}
        >
          {status.type === "loading" ? t("backup.restoring") : t("backup.restore")}
        </button>

        {/* Success */}
        {status.type === "success" && (
          <div className="mt-4 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
            <p className="font-medium">{t("backup.restoreSuccess")}</p>
            <p className="mt-0.5 opacity-80">
              {t("backup.restoreSuccessDesc")}
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
