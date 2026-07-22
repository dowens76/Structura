"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PageShell from "@/components/ui/PageShell";
import SectionHeading from "@/components/ui/SectionHeading";
import Button from "@/components/ui/Button";
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
  const [downloaded,   setDownloaded]   = useState(false);

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
    <PageShell title={t("backup.title")} subtitle={t("backup.description")}>
      <div className="space-y-6">
      {/* ── Export ─────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border p-6" style={surface}>
        <SectionHeading className="mb-1">{t("backup.downloadTitle")}</SectionHeading>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          {t("backup.downloadDesc")}
        </p>
        <a
          href="/api/backup"
          download
          onClick={() => setDownloaded(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: "var(--accent)" }}
        >
          {t("backup.downloadBtn")}
        </a>

        {/* Download confirmation */}
        {downloaded && (
          <div className="mt-4 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
            <p className="font-medium">{t("backup.downloadSuccess")}</p>
          </div>
        )}
      </section>

      {/* ── Restore ────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border p-6" style={surface}>
        <SectionHeading className="mb-1">{t("backup.restoreTitle")}</SectionHeading>
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
          <div className="flex items-center gap-3">
            <Button onClick={() => fileInputRef.current?.click()}>
              {t("backup.chooseFile")}
            </Button>
            {selectedFile && (
              <span className="text-sm truncate max-w-xs" style={{ color: "var(--foreground)" }}>
                {selectedFile.name}
              </span>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".db,application/x-sqlite3,application/octet-stream"
            className="sr-only"
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

        <Button
          variant="danger"
          onClick={handleRestore}
          disabled={!selectedFile || !confirmed || status.type === "loading"}
        >
          {status.type === "loading" ? t("backup.restoring") : t("backup.restore")}
        </Button>

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
    </PageShell>
  );
}
