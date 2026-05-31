"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import LanguagePicker from "@/components/ui/LanguagePicker";
import { useTranslation } from "@/lib/i18n/LocaleContext";

interface NavLinksProps {
  osisBook: string;
  textSource: string;
  chapter: number;
  chapterCount: number;
  isLXX: boolean;
  canParallel: boolean;
  lxxHasOshb: boolean;
  parallelMode: boolean;
  oshbHref: string;
  lxxHref: string;
  parallelHref: string;
  exportHref: string;
  /** OSIS code of the book that follows this one (e.g. "2Sam" when viewing "1Sam"). */
  contNextBook?: string | null;
  /** OSIS code of the book that precedes this one (e.g. "1Sam" when viewing "2Sam"). */
  contPrevBook?: string | null;
  /** Last chapter of contPrevBook — only provided when chapter === 1. */
  contPrevBookLastChapter?: number | null;
  /**
   * Override the previous chapter number for parallel mode when versification
   * differences mean the prev chapter is not simply `chapter - 1`.
   * E.g. from MT Ps 11, prevParallel = 9 (since 9 was shown with 10).
   */
  parallelPrevChapter?: number;
  /**
   * Override the next chapter number for parallel mode when versification
   * differences mean the next chapter is not simply `chapter + 1`.
   * E.g. from MT Ps 9, nextParallel = 11 (since 10 is consumed by the Ps 9 group).
   */
  parallelNextChapter?: number;
}

export default function NavLinks({
  osisBook,
  textSource,
  chapter,
  chapterCount,
  isLXX,
  canParallel,
  lxxHasOshb,
  parallelMode,
  oshbHref,
  lxxHref,
  parallelHref,
  exportHref,
  contNextBook = null,
  contPrevBook = null,
  contPrevBookLastChapter = null,
  parallelPrevChapter,
  parallelNextChapter,
}: NavLinksProps) {
  const { t, refBookName } = useTranslation();

  // Build the export URL with active translations from localStorage.
  // We read localStorage at click time (onClick) rather than relying solely on
  // a useEffect state update, which can race against the user clicking the link
  // before hydration settles in Tauri's WKWebView.
  function buildExportHref(): string {
    try {
      const raw = localStorage.getItem("structura:activeTranslations");
      const abbrs: string[] = raw ? JSON.parse(raw) : [];
      return abbrs.length > 0
        ? `${exportHref}?t=${abbrs.map(encodeURIComponent).join(",")}`
        : exportHref;
    } catch { return exportHref; }
  }

  const [exportHrefWithTranslations, setExportHrefWithTranslations] = useState(exportHref);
  useEffect(() => {
    setExportHrefWithTranslations(buildExportHref());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportHref]);

  return (
    <>
      {/* Source-switch links */}
      {isLXX && lxxHasOshb && (
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
        <Link
          href={lxxHref}
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ color: "var(--nav-fg)" }}
          title={t("nav.titleSwitchLxx")}
        >
          {t("nav.switchToLxx")}
        </Link>
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
          href={exportHrefWithTranslations}
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ color: "var(--nav-fg)" }}
          onClick={(e) => {
            // Re-read localStorage at click time so the latest active translations
            // are always used, even if the useEffect hasn't re-run yet.
            const url = buildExportHref();
            if (url !== exportHrefWithTranslations) {
              e.preventDefault();
              window.location.href = url;
            }
          }}
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
        {(() => {
          const prevCh = parallelMode && parallelPrevChapter != null ? parallelPrevChapter : chapter - 1;
          return prevCh >= 1 ? (
            <Link
              href={`/${encodeURIComponent(osisBook)}/${textSource}/${prevCh}${parallelMode ? "?par=1" : ""}`}
              className="px-2 py-1 rounded text-sm transition-colors"
              style={{ color: "var(--nav-fg)" }}
            >
              ← {prevCh}
            </Link>
          ) : contPrevBook && contPrevBookLastChapter ? (
            <Link
              href={`/${encodeURIComponent(contPrevBook)}/${textSource}/${contPrevBookLastChapter}${parallelMode ? "?par=1" : ""}`}
              className="px-2 py-1 rounded text-sm transition-colors"
              style={{ color: "var(--nav-fg)" }}
              title={`${refBookName(contPrevBook)} ${contPrevBookLastChapter}`}
            >
              ← {refBookName(contPrevBook)} {contPrevBookLastChapter}
            </Link>
          ) : null;
        })()}
        <span
          className="text-sm font-medium px-2"
          style={{ color: "var(--nav-fg)" }}
        >
          {t("nav.chapter", { n: chapter })}
        </span>
        {(() => {
          const nextCh = parallelMode && parallelNextChapter != null ? parallelNextChapter : chapter + 1;
          return nextCh <= chapterCount ? (
            <Link
              href={`/${encodeURIComponent(osisBook)}/${textSource}/${nextCh}${parallelMode ? "?par=1" : ""}`}
              className="px-2 py-1 rounded text-sm transition-colors"
              style={{ color: "var(--nav-fg)" }}
            >
              {nextCh} →
            </Link>
          ) : contNextBook ? (
            <Link
              href={`/${encodeURIComponent(contNextBook)}/${textSource}/1${parallelMode ? "?par=1" : ""}`}
              className="px-2 py-1 rounded text-sm transition-colors"
              style={{ color: "var(--nav-fg)" }}
              title={`${refBookName(contNextBook)} 1`}
            >
              {refBookName(contNextBook)} 1 →
            </Link>
          ) : null;
        })()}
      </div>
    </>
  );
}
