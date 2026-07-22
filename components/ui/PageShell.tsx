"use client";

import type { ReactNode } from "react";
import HomeLink from "@/components/ui/HomeLink";

/**
 * Shared shell for every top-level page reachable from Home's "Manage"
 * section: background/foreground colors, the max-width container, and the
 * HomeLink + title (+ optional subtitle) header block. Page-specific content
 * goes in `children` — the shell only owns the outer frame and header, not
 * body spacing, since that varies too much per page to standardize here.
 */
export default function PageShell({
  title,
  subtitle,
  maxWidth = "max-w-2xl",
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Tailwind max-width class. Only override when content genuinely needs
   *  more room (e.g. a wide table) — default matches most Manage pages. */
  maxWidth?: string;
  children: ReactNode;
}) {
  return (
    <main
      className="min-h-screen"
      style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}
    >
      <div className={`${maxWidth} mx-auto px-6 py-12`}>
        <header className="mb-8">
          <HomeLink className="mb-4" />
          <h1 className="text-3xl font-bold mt-2">{title}</h1>
          {subtitle && (
            <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">{subtitle}</p>
          )}
        </header>
        {children}
      </div>
    </main>
  );
}
