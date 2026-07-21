"use client";

import Link from "next/link";
import { useTranslation } from "@/lib/i18n/LocaleContext";

/** Persistent, prominent link back to the Home screen, used at the top of
 *  every top-level page reachable from Home's "Manage" section. `className`
 *  is appended to the base style — use it for layout/spacing only (e.g.
 *  "mb-4"), not to override the button's look. */
export default function HomeLink({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Link
      href="/"
      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border text-sm font-semibold transition-colors hover:opacity-80 w-fit ${className}`}
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V21h14V9.5" />
      </svg>
      {t("nav.home")}
    </Link>
  );
}
