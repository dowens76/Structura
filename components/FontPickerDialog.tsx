"use client";

/**
 * FontPickerDialog
 *
 * Shows a modal list of available fonts for a given language.
 * Font enumeration strategy (first available wins):
 *   1. Tauri desktop app  → invoke("list_fonts")  via NSFontManager
 *   2. Chromium browser   → window.queryLocalFonts()  (requires permission)
 *   3. Fallback           → curated scholarly/common font list
 *
 * The font name in each row is rendered in that font so the user can see
 * immediately how it looks. A larger preview panel shows sample text in
 * the currently highlighted font.
 *
 * "Apply" immediately persists the selection (calls onApply).
 */

import { useEffect, useRef, useState, useCallback } from "react";

// ── Curated fallback lists ───────────────────────────────────────────────────

const CURATED: Record<FontLanguage, string[]> = {
  hebrew: [
    "Ezra SIL",
    "SBL Hebrew",
    "Frank Rühl Libre",
    "Noto Serif Hebrew",
    "David Libre",
    "Taamey Frank CLM",
    "Miriam CLM",
    "Shofar",
    "Arial Hebrew",
    "Times New Roman",
    "Arial",
  ],
  greek: [
    "Gentium Plus",
    "Gentium Book Plus",
    "GFS Didot",
    "SBL Greek",
    "Cardo",
    "EB Garamond",
    "Noto Serif",
    "Palatino",
    "Palatino Linotype",
    "Times New Roman",
    "Georgia",
  ],
  translation: [
    "system-ui",
    "Georgia",
    "Palatino",
    "Palatino Linotype",
    "Times New Roman",
    "Garamond",
    "EB Garamond",
    "Cambria",
    "Calibri",
    "Arial",
    "Helvetica Neue",
    "Noto Serif",
    "Noto Sans",
    "Linux Libertine",
    "Cardo",
  ],
  transliteration: [
    "Georgia",
    "Palatino",
    "Palatino Linotype",
    "Times New Roman",
    "Garamond",
    "EB Garamond",
    "Cambria",
    "Cardo",
    "Gentium Plus",
    "Gentium Book Plus",
    "Noto Serif",
    "Linux Libertine",
    "Charis SIL",
  ],
};

// Sample text shown in the preview panel
const PREVIEW_TEXT: Record<FontLanguage, string> = {
  hebrew:          "בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ",
  greek:           "Ἐν ἀρχῇ ἦν ὁ λόγος, καὶ ὁ λόγος ἦν πρὸς τὸν θεόν",
  translation:     "In the beginning God created the heavens and the earth",
  transliteration: "Bərēʾšît bārāʾ ʾĕlōhîm ʾēt haššāmayim wəʾēt hāʾāreṣ",
};

// ── Types ────────────────────────────────────────────────────────────────────

export type FontLanguage = "hebrew" | "greek" | "translation" | "transliteration";

interface Props {
  language: FontLanguage;
  /** Currently active custom font (may be empty = "default"). */
  current: string;
  /** Called when the user clicks Apply — persists the chosen font. */
  onApply: (fontFamily: string) => void;
  onClose: () => void;
}

// ── Font-loading helpers ─────────────────────────────────────────────────────

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<Array<{ family: string }>>;
  }
}

async function fetchSystemFonts(): Promise<{ fonts: string[]; source: "system" | "curated" | "permission-denied" }> {
  // 1. Tauri desktop path
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const families = await invoke<string[]>("list_fonts");
      if (families.length > 0) return { fonts: families, source: "system" };
    } catch { /* fall through */ }
  }

  // 2. Chromium browser path (requires user permission)
  if (typeof window !== "undefined" && typeof window.queryLocalFonts === "function") {
    try {
      const fontData = await window.queryLocalFonts();
      const families = [...new Set(fontData.map(f => f.family))].sort();
      if (families.length > 0) return { fonts: families, source: "system" };
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        return { fonts: [], source: "permission-denied" };
      }
      /* other error — fall through to curated */
    }
  }

  return { fonts: [], source: "curated" };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function FontPickerDialog({ language, current, onApply, onClose }: Props) {
  const [allFonts,  setAllFonts]  = useState<string[]>([]);
  const [source,    setSource]    = useState<"system" | "curated" | "permission-denied" | "loading">("loading");
  const [search,    setSearch]    = useState("");
  const [hovered,   setHovered]   = useState<string | null>(null);
  // The font shown in the preview; follows hover, then falls back to selection
  const [selected,  setSelected]  = useState(current);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef   = useRef<HTMLDivElement>(null);

  // Enumerate fonts on mount
  useEffect(() => {
    let cancelled = false;
    fetchSystemFonts().then(({ fonts, source: src }) => {
      if (cancelled) return;
      if (src === "permission-denied") {
        setSource("permission-denied");
        setAllFonts(CURATED[language]);
      } else if (fonts.length > 0) {
        setAllFonts(fonts);
        setSource("system");
      } else {
        setAllFonts(CURATED[language]);
        setSource("curated");
      }
    });
    return () => { cancelled = true; };
  }, [language]);

  // Focus search on open
  useEffect(() => { searchRef.current?.focus(); }, []);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Scroll selected item into view whenever the list renders or search changes
  const scrollToSelected = useCallback(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>("[data-selected='true']");
    el?.scrollIntoView({ block: "nearest" });
  }, []);

  useEffect(() => { scrollToSelected(); }, [allFonts, search, scrollToSelected]);

  const normalised = search.trim().toLowerCase();
  const visible = normalised
    ? allFonts.filter(f => f.toLowerCase().includes(normalised))
    : allFonts;

  // The font shown in the preview pane
  const previewFont = hovered ?? selected;

  const TITLE: Record<FontLanguage, string> = {
    hebrew:          "Choose Hebrew Font",
    greek:           "Choose Greek Font",
    translation:     "Choose Translation Font",
    transliteration: "Choose Transliteration Font",
  };

  const sourceLabel =
    source === "loading"          ? "Loading fonts…" :
    source === "system"           ? `${allFonts.length} system fonts` :
    source === "permission-denied"? "Font access denied — showing suggestions" :
    /* curated */                   "Suggested fonts";

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Dialog */}
      <div
        className="flex flex-col rounded-xl shadow-2xl border overflow-hidden"
        style={{
          width: "min(54rem, 92vw)",
          height: "min(38rem, 88vh)",
          backgroundColor: "var(--surface)",
          borderColor: "var(--border)",
          color: "var(--foreground)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="text-sm font-semibold">{TITLE[language]}</span>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded text-xs transition-colors hover:bg-stone-200 dark:hover:bg-stone-700"
            style={{ color: "var(--text-muted)" }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body — left list + right preview */}
        <div className="flex flex-1 min-h-0">
          {/* Left — search + font list */}
          <div
            className="flex flex-col border-r shrink-0"
            style={{ width: "17rem", borderColor: "var(--border)" }}
          >
            {/* Search box */}
            <div className="px-3 py-2 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search fonts…"
                className="w-full text-xs px-2 py-1.5 rounded border outline-none"
                style={{
                  borderColor: "var(--border)",
                  background: "var(--surface-muted)",
                  color: "var(--foreground)",
                }}
              />
            </div>

            {/* Source label */}
            <div
              className="px-3 py-1.5 text-[10px] border-b shrink-0"
              style={{ color: "var(--text-muted)", borderColor: "var(--border)" }}
            >
              {sourceLabel}
              {normalised && visible.length !== allFonts.length && ` · ${visible.length} match${visible.length !== 1 ? "es" : ""}`}
            </div>

            {/* Font list */}
            <div ref={listRef} className="flex-1 overflow-y-auto">
              {source === "loading" ? (
                <div className="flex items-center justify-center h-full">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>Loading…</span>
                </div>
              ) : visible.length === 0 ? (
                <div className="px-3 py-4 text-xs text-center" style={{ color: "var(--text-muted)" }}>
                  No fonts match "{search}"
                </div>
              ) : (
                visible.map(family => {
                  const isSelected = family === selected;
                  return (
                    <button
                      key={family}
                      data-selected={isSelected ? "true" : undefined}
                      onMouseEnter={() => setHovered(family)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => setSelected(family)}
                      onDoubleClick={() => { setSelected(family); onApply(family); }}
                      className="w-full text-left px-3 py-1.5 text-sm transition-colors"
                      style={{
                        fontFamily: family,
                        backgroundColor: isSelected
                          ? "var(--accent)"
                          : undefined,
                        color: isSelected ? "white" : "var(--foreground)",
                      }}
                    >
                      {family}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right — preview */}
          <div className="flex flex-col flex-1 min-w-0">
            {/* Font name + size selector */}
            <div
              className="px-5 py-3 border-b shrink-0 flex items-center gap-3"
              style={{ borderColor: "var(--border)" }}
            >
              <span className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>
                {previewFont || <span style={{ color: "var(--text-muted)" }}>No font selected</span>}
              </span>
            </div>

            {/* Sample text rendered in the previewed font */}
            <div className="flex-1 overflow-auto px-6 py-8 flex flex-col gap-6">
              {/* Large preview */}
              <div>
                <p
                  className="text-[10px] uppercase tracking-wider mb-2"
                  style={{ color: "var(--text-muted)" }}
                >
                  Preview
                </p>
                <p
                  className="leading-relaxed"
                  style={{
                    fontFamily: previewFont || undefined,
                    fontSize: language === "hebrew" ? "1.5rem" : language === "greek" ? "1.35rem" : "1.1rem",
                    fontStyle: language === "transliteration" ? "italic" : undefined,
                    direction: language === "hebrew" ? "rtl" : "ltr",
                    color: "var(--foreground)",
                  }}
                >
                  {PREVIEW_TEXT[language]}
                </p>
              </div>

              {/* Alphabet / character set */}
              <div>
                <p
                  className="text-[10px] uppercase tracking-wider mb-2"
                  style={{ color: "var(--text-muted)" }}
                >
                  Character set
                </p>
                <p
                  className="leading-relaxed text-sm"
                  style={{
                    fontFamily: previewFont || undefined,
                    fontStyle: language === "transliteration" ? "italic" : undefined,
                    direction: language === "hebrew" ? "rtl" : "ltr",
                    color: "var(--foreground)",
                  }}
                >
                  {language === "hebrew"
                    ? "א ב ג ד ה ו ז ח ט י כ ל מ נ ס ע פ צ ק ר ש ת"
                    : language === "greek"
                    ? "α β γ δ ε ζ η θ ι κ λ μ ν ξ ο π ρ σ τ υ φ χ ψ ω"
                    : "Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj Kk Ll Mm Nn Oo Pp Qq Rr Ss Tt Uu Vv Ww Xx Yy Zz"}
                </p>
              </div>

              {/* Size scale */}
              <div>
                <p
                  className="text-[10px] uppercase tracking-wider mb-2"
                  style={{ color: "var(--text-muted)" }}
                >
                  Size scale
                </p>
                {(["1.5rem", "1.25rem", "1rem", "0.875rem"] as const).map(size => (
                  <p
                    key={size}
                    className="leading-relaxed"
                    style={{
                      fontFamily: previewFont || undefined,
                      fontSize: size,
                      fontStyle: language === "transliteration" ? "italic" : undefined,
                      color: "var(--foreground)",
                    }}
                  >
                    {PREVIEW_TEXT[language].slice(0, 30)}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-5 py-3 border-t shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <button
            onClick={() => { setSelected(""); }}
            className="text-xs px-3 py-1.5 rounded transition-colors"
            style={{ color: "var(--text-muted)" }}
          >
            Reset to default
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-xs px-4 py-1.5 rounded border transition-colors"
              style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
            >
              Cancel
            </button>
            <button
              onClick={() => onApply(selected)}
              className="text-xs px-4 py-1.5 rounded transition-colors font-medium"
              style={{ background: "var(--accent)", color: "white" }}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
