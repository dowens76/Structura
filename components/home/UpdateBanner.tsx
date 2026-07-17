"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n/LocaleContext";
import { fetchJsonRetry } from "@/lib/utils/fetchJsonRetry";

interface VersionCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string;
}

export default function UpdateBanner() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<VersionCheckResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJsonRetry<VersionCheckResult>("/api/version-check").then((result) => {
      if (!cancelled && result?.updateAvailable) setInfo(result);
    });
    return () => { cancelled = true; };
  }, []);

  if (!info?.latestVersion) return null;

  return (
    <div
      className="mb-6 rounded-lg border-l-4 px-4 py-2.5 text-sm"
      style={{ borderLeftColor: "var(--accent)", backgroundColor: "var(--surface-muted)", color: "var(--foreground)" }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{t("home.updateAvailable", { version: info.latestVersion })}</span>
        <a
          href={info.releaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium hover:underline"
          style={{ color: "var(--accent)" }}
        >
          {t("home.updateViewRelease")}
        </a>
      </div>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        {t("home.updateMsStoreNote")}
      </p>
    </div>
  );
}
