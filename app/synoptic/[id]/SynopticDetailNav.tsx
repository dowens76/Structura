"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import DefineSynopticSetDialog from "@/components/synoptic/DefineSynopticSetDialog";
import ThemeToggle from "@/components/ThemeToggle";
import SettingsButton from "@/components/SettingsButton";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import type { SynopticSetWithColumns } from "@/lib/db/queries";

export default function SynopticDetailNav({
  set,
  workspaceId,
  authorName,
}: {
  set: SynopticSetWithColumns;
  workspaceId: number;
  /** The account's Name field (lib/db/queries.ts getAuthorName), null if unset. */
  authorName?: string | null;
}) {
  const router = useRouter();
  const [showEdit, setShowEdit] = useState(false);
  const [pdfStatus, setPdfStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  // Defaults to included whenever an account name exists — matches
  // ExportLayout's own header-field convention (shown unless the user opts out).
  const [includeAuthorName, setIncludeAuthorName] = useState(true);

  async function handleDelete() {
    if (!confirm(`Delete "${set.title}"? The underlying passages and any annotations you've made stay intact.`)) return;
    await fetch(`/api/synoptic-sets/${set.id}`, { method: "DELETE" });
    router.push("/synoptic");
  }

  /**
   * Opens the browser's print dialog on a landscape page containing the
   * whole multi-column comparison — "Save as PDF" produces the export.
   *
   * This prints real, already-rendered DOM clones of each column, not a
   * rasterized image. An earlier version captured each column with
   * html-to-image (toCanvas) and manually paginated the result, but that
   * approach went through four rounds of distinct, hard-to-predict
   * failures in real exported PDFs — a blank tail on tall columns, the
   * tallest column's content duplicating, a blank strip down one edge from
   * a canvas-width mismatch, and (worst) a large chunk of a tall column
   * silently missing only when all four columns were captured in the same
   * export run, which persisted even after fixing the first three and
   * survived deliberately-added settle delays. Each fix confirmed clean in
   * isolation and then failed again in combination, which is the signature
   * of relying on a library to rasterize non-trivial DOM content it wasn't
   * built to render at multi-thousand-pixel heights.
   *
   * Printing real DOM sidesteps that whole class of bug: nothing is ever
   * converted to a raster image, so there is nothing for a rasterizer to
   * get wrong. Each column's scroll container already holds its FULL text
   * in the live DOM (overflow-y:auto only visually clips it — confirmed
   * directly, scrollHeight matches the deepest real content's bounding
   * rect exactly, with no hidden padding). Cloning it, dropping the
   * scroll/height constraint on the clone, and letting the browser's own
   * (heavily-used, well-tested) print pagination lay out the real text
   * across pages is both simpler and far more reliable than pre-computing
   * page slices ourselves.
   *
   * Printing goes through the CURRENT top-level document, not a hidden
   * iframe or a popup window — both were tried earlier and ruled out: a
   * hidden iframe's print code path didn't reliably honor page-break CSS
   * in real output, and window.open() popups can be silently blocked even
   * for a synchronous, click-triggered call. Injecting the print content
   * into the current page and hiding everything else via `@media print`
   * is the standard, most-supported print path in every browser.
   */
  async function handleExportPdf() {
    if (pdfStatus === "loading") return;
    setPdfStatus("loading");

    const printRoot = document.createElement("div");
    printRoot.id = "synoptic-print-root";
    document.body.appendChild(printRoot);
    const printStyle = document.createElement("style");
    printStyle.id = "synoptic-print-style";
    document.head.appendChild(printStyle);

    async function cleanupPrintDom() {
      printRoot.remove();
      printStyle.remove();
    }

    try {
      const grid = document.querySelector<HTMLElement>("[data-synoptic-grid]");
      if (!grid) throw new Error("Synoptic grid not found");

      const scrollContainers = Array.from(grid.querySelectorAll<HTMLElement>("[data-chapter-scroll-container]"));
      if (scrollContainers.length === 0) throw new Error("No columns found");

      const columnsRow = document.createElement("div");
      columnsRow.className = "spr-columns";

      scrollContainers.forEach((col, i) => {
        const clone = col.cloneNode(true) as HTMLElement;

        // Drop UI chrome that's meaningless (or actively mispositioned)
        // once the column is reflowed to its natural, unclipped height:
        // the sticky toolbar, and the RST-relation/word-arrow SVG overlay
        // layer, which is anchored to live scrolled-pixel coordinates that
        // no longer apply after the clone's height constraint is removed.
        // Both overlays render as direct <svg> children of the scroll
        // container (ChapterOverlays' own children) — decorative inline
        // icons deeper in the real verse content are untouched.
        clone.querySelectorAll("[data-chapter-toolbar-area]").forEach((n) => n.remove());
        Array.from(clone.children).forEach((child) => {
          // SVG elements keep their source-case tagName ("svg"), unlike HTML
          // elements which are always uppercased — a plain === "SVG" check
          // never matches, so this must compare case-insensitively.
          if (child.tagName.toLowerCase() === "svg") child.remove();
        });

        clone.removeAttribute("data-chapter-scroll-container");
        clone.style.overflow = "visible";
        clone.style.height = "auto";
        clone.style.maxHeight = "none";
        clone.style.flex = "1 1 0";
        clone.style.minWidth = "0";
        if (i > 0) clone.style.borderLeft = "1px solid #ddd8ce";
        columnsRow.appendChild(clone);
      });

      // The pericope title always heads the page; the author line underneath
      // it stays opt-in via the "Include name" checkbox. Built with DOM
      // methods (not innerHTML) so neither value needs manual HTML-escaping.
      const showAuthorLine = includeAuthorName && !!authorName;
      const headerEl = document.createElement("div");
      headerEl.className = "spr-header";
      const titleEl = document.createElement("div");
      titleEl.className = "spr-title";
      titleEl.textContent = set.title;
      headerEl.appendChild(titleEl);
      if (showAuthorLine) {
        const authorEl = document.createElement("div");
        authorEl.className = "spr-author";
        authorEl.textContent = `Author: ${authorName}`;
        headerEl.appendChild(authorEl);
      }

      printRoot.innerHTML = "";
      printRoot.appendChild(headerEl);
      printRoot.appendChild(columnsRow);

      // On screen, #synoptic-print-root stays display:none (set below) so
      // it never affects normal layout. During print, every OTHER
      // top-level child of <body> is hidden and the print root is shown
      // instead — the whole page (nav, grid, toolbars) is simply absent
      // from the printed output, not just visually covered.
      const MARGIN_IN = 0.4;
      printStyle.textContent = `
        #synoptic-print-root { display: none; }
        @media print {
          body > *:not(#synoptic-print-root) { display: none !important; }
          #synoptic-print-root { display: block !important; }
          @page { size: letter landscape; margin: ${MARGIN_IN}in; }
          #synoptic-print-root .spr-header {
            padding-bottom: 14px;
            margin-bottom: 18px;
            border-bottom: 1px solid #ddd8ce;
          }
          #synoptic-print-root .spr-title {
            font: bold 16px Georgia, 'Times New Roman', serif;
            color: #44403c;
            margin-bottom: 4px;
          }
          #synoptic-print-root .spr-author {
            font: 13px Georgia, 'Times New Roman', serif;
            color: #78716c;
          }
          #synoptic-print-root .spr-columns {
            display: flex;
            flex-direction: row;
            align-items: stretch;
            width: 100%;
          }
          #synoptic-print-root .spr-columns > * {
            padding-left: 12px;
            padding-right: 12px;
          }
          #synoptic-print-root .spr-columns > *:first-child {
            padding-left: 0;
          }
        }
      `;

      await new Promise<void>((resolve) => {
        window.addEventListener("afterprint", () => resolve(), { once: true });
        window.print();
      });
      await cleanupPrintDom();
      setPdfStatus("done");
    } catch (err) {
      console.error("Synoptic PDF export failed:", err);
      await cleanupPrintDom();
      setPdfStatus("error");
    }
    setTimeout(() => setPdfStatus("idle"), 3000);
  }

  return (
    <nav
      className="shrink-0 border-b px-4 py-0 flex items-center gap-3 h-12"
      style={{ borderColor: "var(--nav-border)", backgroundColor: "var(--nav-bg)" }}
    >
      <Link href="/" className="shrink-0 flex items-center" aria-label="Structura home">
        <Image
          src="/structura-icon.svg"
          alt="Structura"
          width={28}
          height={28}
          className="opacity-90"
          style={{ filter: "brightness(0) invert(1)" }}
        />
      </Link>

      <span style={{ color: "var(--nav-border)" }} className="text-lg select-none">|</span>

      <Link
        href="/synoptic"
        className="text-xs px-2 py-1 rounded transition-colors"
        style={{ color: "var(--nav-fg)" }}
      >
        ← Synoptic Sets
      </Link>

      <span className="text-sm font-semibold truncate" style={{ color: "var(--nav-fg-muted)" }}>
        {set.title}
      </span>

      <button
        type="button"
        onClick={() => setShowEdit(true)}
        className="text-xs px-2 py-1 rounded border transition-colors"
        style={{ borderColor: "var(--border)", color: "var(--nav-fg)" }}
      >
        Edit Scope
      </button>
      <button
        type="button"
        onClick={handleDelete}
        className="text-xs px-2 py-1 rounded transition-colors hover:text-red-500"
        style={{ color: "var(--nav-fg-muted)" }}
      >
        Delete
      </button>
      {authorName && (
        <label
          className="flex items-center gap-1 text-xs cursor-pointer select-none"
          style={{ color: "var(--nav-fg-muted)" }}
          title={`Include "${authorName}" (from Account settings) in the exported PDF`}
        >
          <input
            type="checkbox"
            checked={includeAuthorName}
            onChange={(e) => setIncludeAuthorName(e.target.checked)}
            className="accent-amber-600"
          />
          Include name
        </label>
      )}
      <button
        type="button"
        onClick={handleExportPdf}
        disabled={pdfStatus === "loading"}
        className="text-xs px-2 py-1 rounded border transition-colors disabled:opacity-50"
        style={{
          borderColor: "var(--border)",
          color: pdfStatus === "error" ? "#ef4444" : "var(--nav-fg)",
        }}
        title="Export the full comparison as a landscape PDF — opens the print dialog, choose 'Save as PDF'"
      >
        {pdfStatus === "loading"
          ? "Exporting…"
          : pdfStatus === "done"
            ? "✓ PDF"
            : pdfStatus === "error"
              ? "✗ PDF failed"
              : "📄 Export PDF"}
      </button>

      <div className="ml-auto flex items-center gap-1">
        <WorkspaceSwitcher activeWorkspaceId={workspaceId} />
        <SettingsButton />
        <ThemeToggle />
      </div>

      {showEdit && (
        <DefineSynopticSetDialog
          existingSet={set}
          onClose={() => setShowEdit(false)}
          onSaved={() => router.refresh()}
        />
      )}
    </nav>
  );
}
