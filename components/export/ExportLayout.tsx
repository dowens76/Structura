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
        // WKWebView applies @media print CSS and reflows to paper dimensions
        // when invoke("print_page") triggers the native print operation.  The
        // tricky part: structura:print-prepare must fire AFTER the DOM reflects
        // the print layout, so overlays measure positions that match what
        // WKWebView will render on paper.
        //
        // Strategy:
        //   1. Resize annotation columns (same as print CSS does).
        //   2. Inject a temporary <style> that mirrors every @media print rule
        //      that changes segment geometry (font sizes, container max-width).
        //   3. Wait for the resulting reflow (double-RAF).
        //   4. Dispatch structura:print-prepare — overlays now measure at
        //      print-equivalent coordinates with flushSync.
        //   5. Invoke the native print dialog.  WKWebView re-applies the same
        //      @media print rules, producing no second reflow.
        //   6. Restore the DOM after the dialog closes.
        const annotCols = el
          ? Array.from(el.querySelectorAll<HTMLElement>('[class~="w-48"]'))
          : [];
        annotCols.forEach(col => { col.style.width = "8rem"; });

        // Mirror the layout-changing subset of @media print rules so overlays
        // re-measure at the positions WKWebView will actually render.
        //
        // IMPORTANT: use an absolute rem value (42rem = 672px) rather than
        // 100% for the container width.  "100%" resolves to the viewport
        // width on screen but to the printable-area width (~680px for A4,
        // ~702px for US Letter) in print context.  A rem value is the same
        // in both contexts, so the pre-measurement here exactly matches what
        // WKWebView renders — keeping RST arrows correctly anchored.
        // 42rem ≈ 672px fits within both A4 (680px) and Letter (702px)
        // printable widths, so no WKWebView content-scaling occurs.
        const printSim = document.createElement("style");
        printSim.textContent = [
          "[lang='he'], .text-hebrew { font-size: 11pt !important; }",
          "[lang='grc'], .text-greek { font-size: 11pt !important; }",
          "[data-png-crop-to] { max-width: 42rem !important; }",
        ].join("\n");
        document.head.appendChild(printSim);

        try {
          // Give the font-size + max-width reflow time to complete.
          await new Promise<void>(r =>
            requestAnimationFrame(() => requestAnimationFrame(() => r()))
          );

          // Overlays re-measure synchronously (flushSync) at the print layout.
          window.dispatchEvent(new CustomEvent("structura:print-prepare"));

          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("print_page");
        } finally {
          // Restore screen layout — always runs, even if invoke() throws.
          printSim.remove();
          annotCols.forEach(col => { col.style.width = ""; });
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
   * Two rendering paths:
   *
   * Tauri/WKWebView — native capture, scroll-and-stitch:
   *   Calls the Rust `capture_viewport_png` command which uses WKWebView's
   *   `takeSnapshot()` API — the same full HTML renderer that displays the page.
   *   Custom fonts (Ezra SIL, Gentium Plus), BiDi/RTL text shaping, and inline
   *   SVG overlays (RST arrows, word arrows) all render exactly as on screen.
   *   Full-page height is captured by hiding the toolbar, scrolling through the
   *   content in viewport-sized strips, and compositing onto a single canvas.
   *
   * Regular browser — html-to-image:
   *   Serialises the DOM to an SVG <foreignObject> and draws to canvas.  Fonts
   *   embed correctly via the auto-detect path in all desktop browsers.
   *
   * If `cropTo` is supplied the output is cropped to that element's bounds
   * (used to trim blank side-margins from the max-w-4xl inner container).
   */
  async function renderToPng(el: HTMLElement, cropTo?: HTMLElement): Promise<string> {
    // ── Tauri path: native WKWebView HTML renderer ───────────────────────────
    if ("__TAURI_INTERNALS__" in window) {
      const { invoke } = await import("@tauri-apps/api/core");
      const dpr = window.devicePixelRatio || 1;

      // Hide the export toolbar (display:none removes it from layout so it
      // doesn't leave a blank gap and doesn't appear in the screenshot).
      const toolbar = document.querySelector<HTMLElement>(".export-toolbar");
      const prevDisplay = toolbar?.style.display ?? "";
      if (toolbar) toolbar.style.display = "none";

      const savedScrollX = window.scrollX;
      const savedScrollY = window.scrollY;

      try {
        // Re-measure after toolbar removal so coordinates are accurate.
        await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));

        const elRect      = el.getBoundingClientRect();
        const totalHeight = el.scrollHeight;
        const elLeft      = elRect.left;

        // Margin added around the cropped content (0.10" at 96 dpi = ~10 CSS px).
        // This prevents RST arrows (rendered outside the container via
        // SVG overflow-visible) from being clipped at the image edges.
        const MARGIN_CSS = Math.ceil(0.10 * 96); // ≈ 10 CSS px

        // Horizontal crop: strip blank side-margins from the inner container,
        // then expand the crop outward by MARGIN_CSS on each side so that any
        // SVG content that renders outside the container is still captured.
        let srcXOffset    = 0;           // left offset of crop within el, CSS px
        let outCSSW       = elRect.width;
        const topMarginCSS = MARGIN_CSS;

        if (cropTo) {
          const cRect = cropTo.getBoundingClientRect();
          // Expand leftward, but not past the el's own left edge.
          const maxLeftExpand = Math.max(0, cRect.left - elLeft);
          const leftExpand    = Math.min(MARGIN_CSS, maxLeftExpand);
          srcXOffset = (cRect.left - leftExpand) - elLeft;
          outCSSW    = cRect.width + leftExpand + MARGIN_CSS;
        }

        const outW = Math.round(outCSSW                           * dpr);
        const outH = Math.round((totalHeight + topMarginCSS + MARGIN_CSS) * dpr);

        const outCanvas = document.createElement("canvas");
        outCanvas.width  = outW;
        outCanvas.height = outH;
        const ctx = outCanvas.getContext("2d")!;
        // Fill with white so top/bottom margin rows and any transparent
        // regions show as white rather than black.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, outW, outH);

        // scrollBase: window scroll Y that puts el's top edge at viewport y=0.
        const scrollBase = savedScrollY + elRect.top;
        const viewH      = window.innerHeight;
        let destCSSY     = 0; // CSS px composited into outCanvas so far

        while (destCSSY < totalHeight) {
          window.scrollTo(0, scrollBase + destCSSY);

          // Wait for the scroll event, the overlays' double-RAF remeasure, and
          // an extra settling frame so SVG arrows update before we snapshot.
          await new Promise<void>(r =>
            requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)))
          );

          const b64 = await invoke<string>("capture_viewport_png");

          // Re-read el position after scroll (el.top ≈ -destCSSY in viewport).
          const rect         = el.getBoundingClientRect();
          const visibleElTop = Math.max(0, rect.top); // viewport y where el starts
          const remaining    = totalHeight - destCSSY;
          const stripCSS     = Math.min(viewH - visibleElTop, remaining);
          if (stripCSS <= 0) break;

          const srcX = Math.round((rect.left + srcXOffset) * dpr);
          const srcY = Math.round(visibleElTop             * dpr);
          const srcH = Math.round(stripCSS                 * dpr);
          // Offset by topMarginCSS so the content clears the top margin row.
          const dstY = Math.round((destCSSY + topMarginCSS) * dpr);

          await new Promise<void>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              ctx.drawImage(img, srcX, srcY, outW, srcH, 0, dstY, outW, srcH);
              resolve();
            };
            img.onerror = reject;
            img.src = `data:image/png;base64,${b64}`;
          });

          destCSSY += stripCSS;
        }

        return outCanvas.toDataURL("image/png");
      } finally {
        window.scrollTo(savedScrollX, savedScrollY);
        if (toolbar) toolbar.style.display = prevDisplay;
      }
    }

    // ── Regular browser path: html-to-image ──────────────────────────────────
    const { toCanvas } = await import("html-to-image");
    const pixelRatio = 2;
    const render = (opts: object) => toCanvas(el, { pixelRatio, ...opts });
    let canvas: HTMLCanvasElement;
    try {
      canvas = await render({});
    } catch {
      // Retry without font embedding — last-resort fallback
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

          /* Content container: use a fixed rem width (42rem = 672px) rather than
             100%.  "100%" would resolve to paper-printable-area width in print
             context but viewport width on screen, so the pre-print JS measurement
             and the actual WKWebView render would use different widths — shifting
             RST arrows off their anchor points.  42rem is an absolute value that
             resolves identically in both contexts and fits within both A4 (680px)
             and US Letter (702px) printable areas without WKWebView scaling. */
          [data-png-crop-to] { max-width: 42rem !important; }

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

          /* Reduce source-text font sizes for print.  Screen values (≈22 px Hebrew,
             ≈20 px Greek) are too large for a printed study document; 11 pt is a
             standard body-text size.  handlePdf() pre-applies these same rules
             via a temporary <style> element so overlays can re-measure at the
             correct print positions before the native dialog opens. */
          [lang="he"], .text-hebrew { font-size: 11pt !important; }
          [lang="grc"], .text-greek { font-size: 11pt !important; }

          /* Translation footnotes: the app may be in dark mode when printing,
             which makes dark:text-stone-400 (#a8a29e, a very light grey) nearly
             invisible on white paper.  Force a legible dark colour here so
             footnotes always print clearly regardless of light/dark mode. */
          [data-seg-translation] p.italic { color: #3d3530 !important; }
          [data-seg-translation] p.italic sup { color: #6b6058 !important; }
          /* Keep each footnote's text on the same page — prevents a lone
             superscript anchor appearing on one page with the text on the next. */
          [data-seg-translation] > div { break-inside: avoid; page-break-inside: avoid; }
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
