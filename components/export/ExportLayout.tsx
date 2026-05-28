"use client";

import Link from "next/link";
import { useRef, useState, useEffect, type ReactNode } from "react";
import NotesExportMenu from "./NotesExportMenu";
import ImageExportMenu, { type ImagePreset } from "./ImageExportMenu";
import { rgbaCanvasToTiff } from "@/lib/export/tiff-encoder";

// ── Export size ─────────────────────────────────────────────────────────────

type ExportSize = "sm" | "md" | "lg";

// ── Export background ────────────────────────────────────────────────────────

type ExportBg = "transparent" | "white" | "black";

const BG_EXPORT_STYLES: Record<ExportBg, React.CSSProperties> = {
  transparent: { background: "transparent", "--background": "transparent" } as React.CSSProperties,
  white:       { background: "white",       "--background": "white"       } as React.CSSProperties,
  black:       { background: "black",       "--background": "black"       } as React.CSSProperties,
};

/**
 * Screen-resolution font-size CSS vars per size tier.  md uses all defaults
 * (globals.css fallbacks), so its object is empty.
 */
const SCREEN_SIZE_VARS: Record<ExportSize, React.CSSProperties> = {
  sm: {
    "--hebrew-font-size":      "1.1rem",
    "--greek-font-size":       "1.0rem",
    "--translation-font-size": "0.75rem",
  } as React.CSSProperties,
  md: {} as React.CSSProperties,
  lg: {
    "--hebrew-font-size":      "1.65rem",
    "--greek-font-size":       "1.5rem",
    "--translation-font-size": "1.0rem",
  } as React.CSSProperties,
};

/** Source-text font sizes for Tauri @media print pre-measurement and the
 *  print <style> block.  11pt matches the legacy default. */
const PRINT_SOURCE_SIZE: Record<ExportSize, string> = {
  sm: "9pt",
  md: "11pt",
  lg: "13pt",
};

// ── Dark-mode vars ───────────────────────────────────────────────────────────

/**
 * Dark-mode CSS variable overrides applied inline on the content wrapper
 * when the user has chosen dark export.  These cascade to all descendants,
 * overriding the `:root` light values regardless of the app's own theme.
 */
const DARK_EXPORT_STYLE: React.CSSProperties = {
  "--background":       "#111a24",
  "--foreground":       "#ede8df",
  "--surface":          "#1a2535",
  "--surface-muted":    "#1f2f3f",
  "--border":           "#2a3a4a",
  "--border-muted":     "#3a4e62",
  "--text-muted":       "#8a9aaa",
  "--accent":           "#d4aa50",
  "--accent-hover":     "#e0be70",
  "--interlinear-color":"#c96448",
  background:           "#111a24",
} as React.CSSProperties;

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
  const [imgStatus, setImgStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [slidesStatus, setSlidesStatus] = useState<"idle" | "loading" | "done">("idle");
  /** When true, the content wrapper gets dark CSS vars + .dark class so
   *  both the on-screen preview and all captured images use dark colours. */
  const [exportDark, setExportDark] = useState(false);
  /** S / M / L font-size tier for export.  Applies to both PNG and PDF. */
  const [exportSize, setExportSize] = useState<ExportSize>("md");
  /** Background fill: transparent (default), white, or black. */
  const [exportBg, setExportBg] = useState<ExportBg>("transparent");

  // Mirror the current app theme on first render so the toggle starts in a
  // sensible state (dark app → dark export default; light app → light export).
  useEffect(() => {
    setExportDark(document.documentElement.classList.contains("dark"));
  }, []);

  // When the font-size tier changes, CSS vars on the content wrapper update and
  // the browser reflows text at the new sizes.  All three overlay components
  // (WordArrowOverlay, ClauseRelationshipOverlay, RstRelationOverlay) listen for
  // "structura:screen-remeasure" and re-run their scheduleMeasure() path so React
  // state is updated with the new screen-layout positions.
  //
  // Word elements carry `transition: all 0.1s` so the font-size change animates
  // over ~100 ms.  getBoundingClientRect() returns intermediate positions during
  // the animation, so a plain double-RAF (~32 ms) dispatches the event while
  // words are still mid-transition — arrows land at the wrong positions.
  // We wait one RAF (to let the commit paint) then 160 ms (transition + margin)
  // before dispatching so the layout is fully settled.
  useEffect(() => {
    let raf1: number;
    let timeout: ReturnType<typeof setTimeout>;
    raf1 = requestAnimationFrame(() => {
      timeout = setTimeout(() => {
        window.dispatchEvent(new CustomEvent("structura:screen-remeasure"));
      }, 160);
    });
    return () => {
      cancelAnimationFrame(raf1);
      clearTimeout(timeout);
    };
  }, [exportSize]);

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
          `[lang='he'], .text-hebrew { font-size: ${PRINT_SOURCE_SIZE[exportSize]} !important; }`,
          `[lang='grc'], .text-greek { font-size: ${PRINT_SOURCE_SIZE[exportSize]} !important; }`,
          "[data-png-crop-to] { max-width: 42rem !important; }",
          // WordArrowOverlay measures coordinates relative to [data-png-target]
          // (= outerRef, the full-width wrapper div).  Without this rule,
          // outerRef stays at full viewport width during printSim while WKWebView
          // renders it at ≈42rem — creating a horizontal offset equal to
          // (viewport − 42rem) / 2 for every free-form arrow path.
          // Constraining outerRef to the same 42rem here makes the printSim
          // coordinate origin match the WKWebView print coordinate origin exactly.
          "[data-png-target] { max-width: 42rem !important; }",
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
        //
        // PDF is always light-mode regardless of the exportDark toggle.
        // Temporarily strip the dark vars from the content wrapper before
        // capturing, then restore them — size vars are left in place because
        // they don't affect the light/dark appearance.
        const wrapper = textRef.current;
        if (exportDark && wrapper) {
          wrapper.classList.remove("dark");
          for (const key of Object.keys(DARK_EXPORT_STYLE)) {
            wrapper.style.removeProperty(key);
          }
          // Wait for the DOM to repaint in light mode before capturing.
          await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        }

        const pngTargetEl = (el?.querySelector("[data-png-target]") as HTMLElement | null) ?? el;
        const cropTo =
          (pngTargetEl?.querySelector("[data-png-crop-to]") as HTMLElement | null) ?? undefined;
        if (!pngTargetEl) throw new Error("No capture target");
        const bgColor = exportBg === "transparent" ? undefined : exportBg;
        let dataUrl: string;
        try {
          dataUrl = await renderToPng(pngTargetEl, cropTo, 2, bgColor);
        } finally {
          // Always restore the dark wrapper, even if renderToPng throws.
          if (exportDark && wrapper) {
            wrapper.classList.add("dark");
            for (const [key, value] of Object.entries(DARK_EXPORT_STYLE)) {
              wrapper.style.setProperty(key, value as string);
            }
          }
        }

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
  /**
   * Browser-only: render `el` to an HTMLCanvasElement at the given pixelRatio.
   * Crop coordinates are captured before the async toCanvas call to avoid the
   * screen-remeasure scrollbar-shift race (see renderToPng comment).
   */
  async function renderToCanvas(
    el: HTMLElement,
    cropTo: HTMLElement | undefined,
    pixelRatio: number,
    backgroundColor?: string,
  ): Promise<HTMLCanvasElement> {
    const { toCanvas } = await import("html-to-image");
    const baseOpts = backgroundColor ? { pixelRatio, backgroundColor } : { pixelRatio };
    const render = (opts: object) => toCanvas(el, { ...baseOpts, ...opts });

    const elRect   = cropTo ? el.getBoundingClientRect() : null;
    const cropRect = cropTo ? cropTo.getBoundingClientRect() : null;

    let canvas: HTMLCanvasElement;
    try {
      canvas = await render({});
    } catch {
      canvas = await render({ skipFonts: true });
    }

    if (cropTo && elRect && cropRect) {
      const sx = Math.round((cropRect.left - elRect.left) * pixelRatio);
      const sy = Math.round((cropRect.top  - elRect.top)  * pixelRatio);
      const sw = Math.round(cropRect.width  * pixelRatio);
      const sh = Math.round(cropRect.height * pixelRatio);
      const cropped = document.createElement("canvas");
      cropped.width  = sw;
      cropped.height = sh;
      cropped.getContext("2d")!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      return cropped;
    }
    return canvas;
  }

  async function renderToPng(el: HTMLElement, cropTo?: HTMLElement, pixelRatio = 2, backgroundColor?: string): Promise<string> {
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
    // Delegates to renderToCanvas (crop-coordinate race fix lives there).
    const canvas = await renderToCanvas(el, cropTo, pixelRatio, backgroundColor);
    return canvas.toDataURL("image/png");
  }

  /**
   * Export the chapter/passage as an image in one of three quality presets:
   *
   *   "presentation" — PNG at 1× pixel ratio (compact file, screen/slide use)
   *   "hifi"         — PNG at 1.5× (144 PPI, crisp on HiDPI / Retina screens)
   *   "print"        — TIFF at ≈3.125× (300 DPI), CMYK colour, no compression
   *
   * Pixel-ratio mapping assumes a 96 CSS px/in reference density:
   *   1  × 96 =  96 PPI  → presentation (close to the 72 PPI target)
   *   1.5× 96 = 144 PPI  → high-fidelity
   *   300 / 96 ≈ 3.125×  → print-ready 300 DPI
   *
   * The Tauri path always captures at native device DPR via WKWebView; the
   * pixelRatio only affects the browser (html-to-image) path.
   */
  async function handleImageExport(preset: ImagePreset) {
    if (!textRef.current || imgStatus === "loading") return;
    setImgStatus("loading");

    // Allow any pending overlay re-measurements to settle before capture.
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));

    try {
      // [data-png-target]: outerRef — full-width so nothing is clipped.
      // [data-png-crop-to]: containerRef (max-w-4xl) — trims blank side margins.
      const pngTarget =
        (textRef.current.querySelector("[data-png-target]") as HTMLElement | null)
        ?? textRef.current;
      const cropTo =
        pngTarget.querySelector("[data-png-crop-to]") as HTMLElement | undefined ?? undefined;

      // For the browser html-to-image path, backgroundColor is passed directly
      // to toCanvas (the html-to-image option). For the Tauri viewport-capture
      // path, the background is already on textRef and rendered by WKWebView.
      const bgColor = exportBg === "transparent" ? undefined : exportBg;

      const pixelRatio =
        preset === "presentation" ? 1      :
        preset === "hifi"         ? 1.5    :
        /* print */                 300 / 96; // ≈3.125 → 300 DPI

      if (preset === "print") {
        // ── TIFF / CMYK path ────────────────────────────────────────────────
        if ("__TAURI_INTERNALS__" in window) {
          // Tauri captures at native DPR; load the result into a canvas so we
          // can apply the same RGBA→CMYK conversion as the browser path.
          const dataUrlPng = await renderToPng(pngTarget, cropTo, pixelRatio);
          const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = reject;
            i.src = dataUrlPng;
          });
          const tmp = document.createElement("canvas");
          tmp.width = img.width; tmp.height = img.height;
          tmp.getContext("2d")!.drawImage(img, 0, 0);
          const tiffBytes = rgbaCanvasToTiff(tmp, 300);
          const blob = new Blob([tiffBytes], { type: "image/tiff" });
          const tiffDataUrl = await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload  = () => resolve(fr.result as string);
            fr.onerror = reject;
            fr.readAsDataURL(blob);
          });
          const { invoke } = await import("@tauri-apps/api/core");
          const saved = await invoke<boolean>("save_file", {
            filename: `structura-${filename}.tif`,
            dataUrl: tiffDataUrl,
            filterName: "TIFF Image",
            ext: "tif",
          });
          if (!saved) { setImgStatus("idle"); return; }
        } else {
          // Browser path: render to canvas, convert to CMYK TIFF, download.
          const canvas = await renderToCanvas(pngTarget, cropTo, pixelRatio, bgColor);
          const tiffBytes = rgbaCanvasToTiff(canvas, 300);
          const blob = new Blob([tiffBytes], { type: "image/tiff" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `structura-${filename}.tif`;
          a.click();
          URL.revokeObjectURL(url);
        }
      } else {
        // ── PNG path (presentation or hifi) ─────────────────────────────────
        const url = await renderToPng(pngTarget, cropTo, pixelRatio, bgColor);

        // WKWebView (Tauri Mac) does not honour `<a download>` for data URLs.
        if ("__TAURI_INTERNALS__" in window) {
          const { invoke } = await import("@tauri-apps/api/core");
          const saved = await invoke<boolean>("save_file", {
            filename: `structura-${filename}.png`,
            dataUrl: url,
            filterName: "PNG Image",
            ext: "png",
          });
          if (!saved) { setImgStatus("idle"); return; }
        } else {
          const a = document.createElement("a");
          a.href = url;
          a.download = `structura-${filename}.png`;
          a.click();
        }
      }

      setImgStatus("done");
    } catch (err) {
      console.error("Image export failed:", err);
      setImgStatus("error");
    }
    setTimeout(() => setImgStatus("idle"), 3000);
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
      {/* Print-only CSS — establishes the baseline light-mode print theme. */}
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

          /* Constrain the outer wrapper (WordArrowOverlay's coordinate origin) to
             the same 42rem so free-form arrow paths computed during the
             structura:print-prepare pre-measurement land at identical pixel
             positions in the WKWebView render.  Without this, outerRef is full
             viewport width on screen but only ≈42rem in the print context,
             shifting every free-form arrow by (viewport − 42rem) / 2. */
          [data-png-target] { max-width: 42rem !important; }

          /* Default: force light-mode CSS variables so print is black-on-white.
             The dark-export override block below supersedes this when active. */
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
             ≈20 px Greek) are too large for a printed study document; the size
             follows the S/M/L selector (9 pt / 11 pt / 13 pt).  handlePdf()
             pre-applies these same rules via a temporary injected stylesheet so
             overlays can re-measure at the correct print positions before the
             native dialog opens. */
          [lang="he"], .text-hebrew { font-size: ${PRINT_SOURCE_SIZE[exportSize]} !important; }
          [lang="grc"], .text-greek { font-size: ${PRINT_SOURCE_SIZE[exportSize]} !important; }

          /* Translation footnotes: force a legible colour so they always print
             clearly regardless of light/dark mode. */
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

          {/* Dark / light export toggle */}
          <button
            onClick={() => setExportDark(v => !v)}
            title={exportDark ? "Switch to light export" : "Switch to dark export"}
            className={[
              btnBase,
              "w-[2.1rem] text-center",
              exportDark
                ? "bg-stone-800 text-amber-300 hover:bg-stone-700 ring-1 ring-stone-600"
                : "bg-stone-100 text-stone-500 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700",
            ].join(" ")}
          >
            {exportDark ? "🌙" : "☀️"}
          </button>

          {/* Font size: S / M / L */}
          <div
            className="flex rounded overflow-hidden border"
            style={{ borderColor: "var(--border)" }}
            title="Font size"
          >
            {(["sm", "md", "lg"] as ExportSize[]).map((sz, i) => (
              <button
                key={sz}
                onClick={() => setExportSize(sz)}
                title={sz === "sm" ? "Small font" : sz === "md" ? "Medium font" : "Large font"}
                className={[
                  "px-2 py-1 text-xs font-medium transition-colors leading-none",
                  i > 0 ? "border-l" : "",
                  exportSize === sz
                    ? "bg-stone-600 text-white dark:bg-stone-500"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700",
                ].join(" ")}
                style={i > 0 ? { borderColor: "var(--border)" } : undefined}
              >
                {sz === "sm" ? "S" : sz === "md" ? "M" : "L"}
              </button>
            ))}
          </div>

          {/* Background: transparent / white / black */}
          <div
            className="flex rounded overflow-hidden border"
            style={{ borderColor: "var(--border)" }}
            title="Export background"
          >
            {(["transparent", "white", "black"] as ExportBg[]).map((bg, i) => (
              <button
                key={bg}
                onClick={() => setExportBg(bg)}
                title={bg === "transparent" ? "Transparent background" : bg === "white" ? "White background" : "Black background"}
                className={[
                  "px-2 py-1 transition-colors leading-none flex items-center justify-center",
                  i > 0 ? "border-l" : "",
                  exportBg === bg
                    ? "bg-stone-600 dark:bg-stone-500"
                    : "bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700",
                ].join(" ")}
                style={i > 0 ? { borderColor: "var(--border)" } : undefined}
              >
                {bg === "transparent" ? (
                  <span style={{ display: "inline-block", width: "0.7rem", height: "0.7rem", border: "1.5px dashed", borderColor: exportBg === bg ? "white" : "#78716c", borderRadius: "2px" }} />
                ) : (
                  <span style={{ display: "inline-block", width: "0.7rem", height: "0.7rem", background: bg, border: bg === "white" ? "1px solid #aaa" : "1px solid #444", borderRadius: "2px" }} />
                )}
              </button>
            ))}
          </div>

          <span className="w-px h-4 rounded" style={{ backgroundColor: "var(--border)" }} aria-hidden="true" />

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
          <ImageExportMenu status={imgStatus} onExport={handleImageExport} />
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

      {/* Content area.
          data-export-size — matched by the [data-export-size="sm/lg"] CSS rules in
          the <style> block above to set --hebrew/greek/translation-font-size vars.
          When exportDark is true:
            • className="dark"  → activates all Tailwind dark: utilities on descendants
            • DARK_EXPORT_STYLE → overrides :root CSS vars for this subtree so every
              var(--foreground) / var(--surface) / etc. resolves to the dark palette
            • background        → fills the wrapper itself with the dark background */}
      <div
        ref={textRef}
        data-export-size={exportSize}
        className={exportDark ? "dark" : ""}
        style={{ ...(exportDark ? DARK_EXPORT_STYLE : {}), ...BG_EXPORT_STYLES[exportBg] }}
      >
        {children}
      </div>
    </>
  );
}
