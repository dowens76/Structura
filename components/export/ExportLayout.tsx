"use client";

import { useRef, useState, type ReactNode } from "react";
import NotesExportMenu from "./NotesExportMenu";

interface Props {
  children: ReactNode;
  /** URL to the Reveal.js API route for this chapter/passage */
  revealHref: string;
  /** Suggested filename stem, e.g. "Gen-1" or "passage-4" */
  filename: string;
  /** When provided, a Notes export menu is shown in the toolbar. */
  noteContext?: {
    /** Human-readable document title, e.g. "Genesis 1" */
    title: string;
    /** All note keys to include (chapter + verse keys in order) */
    keys: string[];
  };
}

export default function ExportLayout({ children, revealHref, filename, noteContext }: Props) {
  const textRef = useRef<HTMLDivElement>(null);
  const [pngStatus, setPngStatus] = useState<"idle" | "loading" | "done">("idle");
  const [slidesStatus, setSlidesStatus] = useState<"idle" | "loading" | "done">("idle");

  async function handlePng() {
    if (!textRef.current || pngStatus === "loading") return;
    setPngStatus("loading");
    try {
      const { toPng } = await import("html-to-image");
      const bg =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--background")
          .trim() || "#f8f6f2";
      const url = await toPng(textRef.current, {
        pixelRatio: 2,
        backgroundColor: bg,
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = `structura-${filename}.png`;
      a.click();
      setPngStatus("done");
    } catch (err) {
      console.error("PNG export failed:", err);
      setPngStatus("idle");
    }
    setTimeout(() => setPngStatus("idle"), 2000);
  }

  async function handleSlides() {
    if (slidesStatus === "loading") return;
    setSlidesStatus("loading");
    try {
      const res = await fetch(revealHref);
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `structura-${filename}.html`;
      a.click();
      URL.revokeObjectURL(url);
      setSlidesStatus("done");
    } catch (err) {
      console.error("Slides export failed:", err);
      setSlidesStatus("idle");
    }
    setTimeout(() => setSlidesStatus("idle"), 2000);
  }

  const btnBase =
    "px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50";
  const btnPrimary = `${btnBase} bg-stone-700 text-white hover:bg-stone-800`;
  const btnSecondary = `${btnBase} bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-200 dark:hover:bg-stone-700`;

  return (
    <>
      {/* Print-only CSS — hides toolbar */}
      <style>{`
        @media print {
          .export-toolbar { display: none !important; }
          body { background: white !important; }
          @page { margin: 1.5cm; }
        }
      `}</style>

      {/* Floating toolbar */}
      <div
        className="export-toolbar sticky top-4 z-20 flex justify-end px-6 pointer-events-none"
        aria-hidden="false"
      >
        <div
          className="pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-xl shadow-lg border text-sm"
          style={{
            backgroundColor: "var(--surface)",
            borderColor: "var(--border)",
          }}
        >
          <span className="text-xs font-medium mr-1" style={{ color: "var(--text-muted)" }}>
            Export:
          </span>
          <button
            className={btnPrimary}
            onClick={() => window.print()}
            title="Open print dialog — choose 'Save as PDF' in the destination"
          >
            📄 PDF
          </button>
          <button
            className={btnSecondary}
            onClick={handlePng}
            disabled={pngStatus === "loading"}
            title="Download a PNG screenshot of the text"
          >
            {pngStatus === "loading" ? "Rendering…" : pngStatus === "done" ? "✓ PNG" : "🖼 PNG"}
          </button>
          {/* Slides export hidden — code preserved, not yet exposed in UI
          <button
            className={btnSecondary}
            onClick={handleSlides}
            disabled={slidesStatus === "loading"}
            title="Download a self-contained Reveal.js HTML presentation"
          >
            {slidesStatus === "loading" ? "Building…" : slidesStatus === "done" ? "✓ Slides" : "🎞 Slides"}
          </button>
          */}

          {noteContext && (
            <>
              <span
                className="w-px h-4 rounded"
                style={{ backgroundColor: "var(--border)" }}
                aria-hidden="true"
              />
              <NotesExportMenu
                noteKeys={noteContext.keys}
                title={noteContext.title}
                filename={filename}
              />
            </>
          )}
        </div>
      </div>

      {/* Text content captured by html2canvas */}
      <div ref={textRef}>
        {children}
      </div>
    </>
  );
}
