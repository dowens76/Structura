"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import NotesExportMenu from "./NotesExportMenu";

interface Props {
  children: ReactNode;
  /** URL to the Reveal.js API route for this chapter/passage */
  revealHref: string;
  /** Suggested filename stem, e.g. "Gen-1" or "passage-4" */
  filename: string;
  /** URL to navigate back to the source chapter or passage */
  backHref: string;
  /** When provided, a Notes export menu is shown in the toolbar. */
  noteContext?: {
    /** Human-readable document title, e.g. "Genesis 1" */
    title: string;
    /** All note keys to include (chapter + verse keys in order) */
    keys: string[];
  };
}

export default function ExportLayout({ children, revealHref, filename, backHref, noteContext }: Props) {
  const textRef = useRef<HTMLDivElement>(null);
  const [pdfStatus, setPdfStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [pngStatus, setPngStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [slidesStatus, setSlidesStatus] = useState<"idle" | "loading" | "done">("idle");

  async function handlePdf() {
    if (pdfStatus === "loading") return;
    setPdfStatus("loading");

    const el = textRef.current;

    try {
      if ("__TAURI_INTERNALS__" in window) {
        // ── WKWebView / Tauri ────────────────────────────────────────────────
        // invoking native print reflows the WKWebView to paper dimensions and
        // applies @media print CSS — both of which shift SVG overlay coordinates
        // that were measured at screen width.  To avoid this, we capture the
        // current view as a PNG first, inject a full-page print overlay, and
        // then invoke print so WKWebView prints only the PNG image.
        const pngTarget =
          (el?.querySelector("[data-png-target]") as HTMLElement | null) ?? el;
        const cropTo =
          (pngTarget?.querySelector("[data-png-crop-to]") as HTMLElement | null) ?? undefined;
        if (!pngTarget) throw new Error("No capture target");

        const dataUrl = await renderToPng(pngTarget, cropTo);

        // Inject a @media print rule that hides every direct body child except
        // our overlay div, so WKWebView prints only the captured PNG image.
        const printStyle = document.createElement("style");
        printStyle.textContent =
          "@media print {\n" +
          "  body > *:not([data-structura-print-overlay]) { display: none !important; }\n" +
          "  [data-structura-print-overlay] { display: block !important; }\n" +
          "}\n";
        const printDiv = document.createElement("div");
        printDiv.setAttribute("data-structura-print-overlay", "");
        printDiv.style.cssText = "background:white;margin:0;padding:0;";
        const imgEl = document.createElement("img");
        imgEl.src = dataUrl;
        imgEl.style.cssText = "display:block;max-width:100%;height:auto;";
        printDiv.appendChild(imgEl);

        document.head.appendChild(printStyle);
        document.body.appendChild(printDiv);
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("print_page");
        } finally {
          document.head.removeChild(printStyle);
          document.body.removeChild(printDiv);
        }
      } else {
        // ── Regular browser ──────────────────────────────────────────────────
        // Capture the content as a canvas image (same pipeline as PNG export),
        // then print it inside a hidden iframe. This sidesteps print-CSS reflow
        // and SVG re-measurement timing issues that affect window.print() on
        // the live page — the captured image is already pixel-perfect.
        const pngTarget =
          (el?.querySelector("[data-png-target]") as HTMLElement | null) ?? el;
        const cropTo =
          (pngTarget?.querySelector("[data-png-crop-to]") as HTMLElement | null) ?? undefined;
        if (!pngTarget) throw new Error("No capture target");

        const dataUrl = await renderToPng(pngTarget, cropTo);

        const iframe = document.createElement("iframe");
        iframe.style.cssText =
          "position:fixed;width:0;height:0;border:none;left:-9999px;top:-9999px;";
        document.body.appendChild(iframe);
        try {
          const iDoc = iframe.contentDocument!;
          iDoc.open();
          iDoc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
            @page { margin: 1.5cm; }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { background: white; }
            img {
              display: block;
              max-width: 100%;
              height: auto;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          </style></head><body><img src="${dataUrl}"></body></html>`);
          iDoc.close();

          // Wait for the image to finish loading inside the iframe.
          await new Promise<void>((resolve) => {
            const img = iDoc.querySelector("img") as HTMLImageElement;
            if (img.complete) { resolve(); return; }
            img.onload = () => resolve();
          });

          // Print and wait until the dialog is dismissed before cleaning up.
          await new Promise<void>((resolve) => {
            iframe.contentWindow!.addEventListener("afterprint", () => resolve(), { once: true });
            iframe.contentWindow!.print();
          });
        } finally {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        }
      }
      setPdfStatus("done");
    } catch (err) {
      console.error("PDF export failed:", err);
      setPdfStatus("error");
    }
    setTimeout(() => setPdfStatus("idle"), 3000);
  }

  /**
   * Render an element to a transparent-background PNG data URL.
   *
   * html-to-image serialises the DOM to an SVG <foreignObject> then loads it
   * as a data-URL in an <img> tag before drawing on canvas. In some WKWebView
   * builds this step silently produces a blank image. We try twice:
   *   1. Full rendering (fonts embedded as base64) — works in all browsers.
   *   2. skipFonts:true — skips external-font fetching. WKWebView still renders
   *      text using the already-loaded page fonts, which avoids the timeout/
   *      CORS failure that can occur when the renderer tries to re-fetch fonts
   *      from the tauri://localhost origin.
   *
   * If `cropTo` is supplied the canvas is cropped to that element's bounding
   * rect (relative to `el`) so that blank side-margins are stripped while still
   * allowing `el` to be the full-width capture root (preventing any overflow
   * clipping that would happen if we captured the narrower inner element directly).
   */
  async function renderToPng(el: HTMLElement, cropTo?: HTMLElement): Promise<string> {
    const { toCanvas } = await import("html-to-image");
    const pixelRatio = 2;

    // In Tauri's WKWebView, html-to-image cannot embed external @font-face fonts
    // (the fetch of /fonts/SILEOT.woff is blocked or silently ignored inside the
    // canvas SVG renderer).  Pre-fetch the Ezra SIL woff file ourselves and supply
    // it as a base64 data-URL via fontEmbedCSS so Hebrew text renders with the
    // correct glyphs rather than a fallback serif.
    let fontEmbedCSS: string | undefined;
    if ("__TAURI_INTERNALS__" in window) {
      try {
        const fontResp = await fetch("/fonts/SILEOT.woff");
        const fontBlob = await fontResp.blob();
        const fontDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload  = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(fontBlob);
        });
        fontEmbedCSS =
          `@font-face { font-family: "Ezra SIL"; ` +
          `src: url("${fontDataUrl}") format("woff"); ` +
          `font-weight: 400; font-style: normal; }`;
      } catch { /* fall through — html-to-image will attempt its own font fetching */ }
    }

    const render = (opts: object) => toCanvas(el, { pixelRatio, ...opts });
    let canvas: HTMLCanvasElement;
    try {
      canvas = await render(fontEmbedCSS ? { fontEmbedCSS } : {});
    } catch {
      // Retry without font embedding — last-resort for WKWebView environments
      canvas = await render({ skipFonts: true });
    }

    // Crop to the inner content element's bounds if provided
    if (cropTo) {
      const elRect   = el.getBoundingClientRect();
      const cropRect = cropTo.getBoundingClientRect();
      const sx = Math.round((cropRect.left - elRect.left) * pixelRatio);
      const sy = Math.round((cropRect.top  - elRect.top)  * pixelRatio);
      const sw = Math.round(cropRect.width  * pixelRatio);
      const sh = Math.round(cropRect.height * pixelRatio);

      const cropped = document.createElement("canvas");
      cropped.width  = sw;
      cropped.height = sh;
      cropped.getContext("2d")!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      return cropped.toDataURL("image/png");
    }

    return canvas.toDataURL("image/png");
  }

  async function handlePng() {
    if (!textRef.current || pngStatus === "loading") return;
    setPngStatus("loading");
    try {
      // [data-png-target]: outerRef — full-width, so nothing can be clipped.
      // [data-png-crop-to]: containerRef (max-w-4xl) — used to trim blank side margins.
      const pngTarget =
        (textRef.current.querySelector("[data-png-target]") as HTMLElement | null)
        ?? textRef.current;
      const cropTo =
        pngTarget.querySelector("[data-png-crop-to]") as HTMLElement | undefined ?? undefined;
      const url = await renderToPng(pngTarget, cropTo);

      // WKWebView (Tauri Mac) does not honour `<a download>` for data URLs.
      // Detect Tauri at call-time (event handlers are always client-side) and
      // delegate the save dialog + file write to the Rust command instead.
      if ("__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        const saved = await invoke<boolean>("save_file", {
          filename: `structura-${filename}.png`,
          dataUrl: url,
          filterName: "PNG Image",
          ext: "png",
        });
        if (!saved) {
          // User cancelled — stay idle rather than showing "done"
          setPngStatus("idle");
          return;
        }
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `structura-${filename}.png`;
        a.click();
      }

      setPngStatus("done");
    } catch (err) {
      console.error("PNG export failed:", err);
      setPngStatus("error");
    }
    setTimeout(() => setPngStatus("idle"), 3000);
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
      {/* Print-only CSS — white background regardless of current theme */}
      <style>{`
        @media print {
          .export-toolbar { display: none !important; }
          @page { margin: 1.5cm; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

          /* Annotation column: shrink from w-48 (12 rem) to 8 rem in portrait
             layout so source and translation columns each get ~206 px.
             handlePdf() applies the same change in JS before measuring arrows,
             keeping SVG coordinates consistent with the printed layout. */
          [data-png-target] [class~="w-48"] { width: 8rem !important; }

          /* Content container: fill the full printable width regardless of the
             screen-layout max-width cap.  The browser reflows to paper width;
             removing the cap here lets content use every available millimetre. */
          [data-png-crop-to] { max-width: 100% !important; }

          /* Force light-mode CSS variables so print is always black-on-white,
             even when the app is in dark mode. All children inherit from here. */
          [data-export-page] {
            background: white !important;
            --background: white;
            --foreground: #1f2f3f;
            --surface: #ffffff;
            --surface-muted: #f1ede5;
            --border: #ddd8ce;
            --border-muted: #ccc5b8;
            --text-muted: #7a6e5e;
            --accent: #c89b3c;
            --accent-hover: #a87d28;
            --interlinear-color: #b04a32;
          }
        }
      `}</style>

      {/* Floating toolbar */}
      <div
        className="export-toolbar sticky top-4 z-20 flex justify-between px-6 pointer-events-none"
        aria-hidden="false"
      >
        <Link
          href={backHref}
          className="pointer-events-auto px-3 py-1.5 rounded-xl shadow-lg border text-xs font-medium transition-colors"
          style={{
            backgroundColor: "var(--surface)",
            borderColor: "var(--border)",
            color: "var(--text-muted)",
          }}
          title="Go back"
        >
          ← Back
        </Link>
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
            className={pdfStatus === "error" ? `${btnBase} bg-red-600 text-white` : btnPrimary}
            onClick={handlePdf}
            disabled={pdfStatus === "loading"}
            title="Open print dialog — choose 'Save as PDF' in the destination"
          >
            {pdfStatus === "loading"
              ? "Opening…"
              : pdfStatus === "done"
                ? "✓ PDF"
                : pdfStatus === "error"
                  ? "✗ PDF failed"
                  : "📄 PDF"}
          </button>
          <button
            className={pngStatus === "error" ? `${btnBase} bg-red-600 text-white` : btnSecondary}
            onClick={handlePng}
            disabled={pngStatus === "loading"}
            title="Download a PNG screenshot of the text"
          >
            {pngStatus === "loading"
              ? "Rendering…"
              : pngStatus === "done"
                ? "✓ PNG"
                : pngStatus === "error"
                  ? "✗ PNG failed"
                  : "🖼 PNG"}
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
