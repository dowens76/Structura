"use client";

import Link from "next/link";
import LanguagePicker from "@/components/ui/LanguagePicker";
import { useTranslation } from "@/lib/i18n/LocaleContext";

interface NavLinksProps {
  osisBook: string;
  textSource: string;
  chapter: number;
  chapterCount: number;
  isLXX: boolean;
  canParallel: boolean;
  parallelMode: boolean;
  oshbHref: string;
  lxxHref: string;
  parallelHref: string;
  exportHref: string;
}

export default function NavLinks({
  osisBook,
  textSource,
  chapter,
  chapterCount,
  isLXX,
  canParallel,
  parallelMode,
  oshbHref,
  lxxHref,
  parallelHref,
  exportHref,
}: NavLinksProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* Source-switch links */}
      {isLXX && canParallel && (
        <Link
          href={oshbHref}
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ color: "var(--nav-fg)" }}
          title={t("nav.titleSwitchOshb")}
        >
          {t("nav.switchToOshb")}
        </Link>
      )}
      {textSource === "OSHB" && canParallel && !parallelMode && (
        <>
          <Link
            href={parallelHref}
            className="text-xs px-2 py-1 rounded transition-colors"
            style={{ color: "var(--nav-fg)" }}
            title={t("nav.titleParallelLxx")}
          >
            {t("nav.parallelLxx")}
          </Link>
          <Link
            href={lxxHref}
            className="text-xs px-2 py-1 rounded transition-colors"
            style={{ color: "var(--nav-fg)" }}
            title={t("nav.titleSwitchLxx")}
          >
            {t("nav.switchToLxx")}
          </Link>
        </>
      )}
      {parallelMode && (
        <Link
          href={`/${encodeURIComponent(osisBook)}/OSHB/${chapter}`}
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ color: "var(--nav-fg)" }}
          title={t("nav.titleExitParallel")}
        >
          {t("nav.exitParallel")}
        </Link>
      )}

      {/* Utility links */}
      <Link
        href="/export/lists"
        className="text-xs px-2 py-1 rounded transition-colors"
        style={{ color: "var(--nav-fg)" }}
      >
        Lists
      </Link>
      <Link
        href="/import"
        className="text-xs px-2 py-1 rounded transition-colors"
        style={{ color: "var(--nav-fg)" }}
      >
        {t("nav.import")}
      </Link>
      <Link
        href="/backup"
        className="text-xs px-2 py-1 rounded transition-colors"
        style={{ color: "var(--nav-fg)" }}
      >
        {t("nav.backup")}
      </Link>
      {!parallelMode && (
        <Link
          href={exportHref}
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ color: "var(--nav-fg)" }}
        >
          {t("nav.export")}
        </Link>
      )}
      <Link
        href="/account"
        className="text-xs px-2 py-1 rounded transition-colors"
        style={{ color: "var(--nav-fg)" }}
      >
        {t("nav.account")}
      </Link>

      {/* Language picker */}
      <LanguagePicker />

      {/* Chapter navigation (right side) */}
      <div className="ml-auto flex items-center gap-1">
        {chapter > 1 && (
          <Link
            href={`/${encodeURIComponent(osisBook)}/${textSource}/${chapter - 1}${parallelMode ? "?par=1" : ""}`}
            className="px-2 py-1 rounded text-sm transition-colors"
            style={{ color: "var(--nav-fg)" }}
          >
            ← {chapter - 1}
          </Link>
        )}
        <span
          className="text-sm font-medium px-2"
          style={{ color: "var(--nav-fg)" }}
        >
          {t("nav.chapter", { n: chapter })}
        </span>
        {chapter < chapterCount && (
          <Link
            href={`/${encodeURIComponent(osisBook)}/${textSource}/${chapter + 1}${parallelMode ? "?par=1" : ""}`}
            className="px-2 py-1 rounded text-sm transition-colors"
            style={{ color: "var(--nav-fg)" }}
          >
            {chapter + 1} →
          </Link>
        )}
      </div>
    </>
  );
}
