"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "@/lib/i18n/LocaleContext";

// localStorage keys for per-locale translation preferences
const PREF_KEY = (locale: string) => `scripture:tooltipTranslation:${locale}`;

export type TranslationPref =
  | { source: "local"; id: number; abbr?: string }
  | { source: "fetchbible"; translationId: string; abbr?: string }
  | { source: "api"; bibleId: string; abbr?: string };

// Reads the stored preference for the given locale
function getTranslationPref(locale: string): TranslationPref | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PREF_KEY(locale));
    return raw ? (JSON.parse(raw) as TranslationPref) : null;
  } catch {
    return null;
  }
}

type TooltipState =
  | { status: "loading" }
  | { status: "ok"; text: string; translation: string }
  | { status: "not_found" }
  | { status: "no_translation" }
  | { status: "error" };

interface Props {
  osisRef: string;
  anchorPos: { x: number; y: number };
  onCancelLeave: () => void;
  onClose: () => void;
}

export default function ScriptureTooltip({
  osisRef,
  anchorPos,
  onCancelLeave,
  onClose,
}: Props) {
  const { t, locale } = useTranslation();
  const [state, setState] = useState<TooltipState>({ status: "loading" });
  const [copied, setCopied] = useState(false);
  const tooltipEl = useRef<HTMLDivElement>(null);
  const fetchCountRef = useRef(0);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    left: anchorPos.x,
    top: anchorPos.y,
    visibility: "hidden", // hide until positioned
  });

  // Fetch verse text when the ref or locale changes.
  // Uses a ref-based counter rather than a closure-scoped flag so that React
  // Strict Mode's double-invocation (setup → cleanup → setup) does not leave
  // the component stuck in "loading": the ref persists across both invocations,
  // so only the second (surviving) fetch ever commits its result.
  useEffect(() => {
    const myCount = ++fetchCountRef.current;
    setState({ status: "loading" });

    const pref = getTranslationPref(locale);
    if (!pref) {
      setState({ status: "no_translation" });
      return;
    }

    const params = new URLSearchParams({ ref: osisRef });
    if (pref.source === "local") {
      params.set("localId", String(pref.id));
    } else if (pref.source === "fetchbible") {
      params.set("fetchBibleId", pref.translationId);
      if (pref.abbr) params.set("abbr", pref.abbr);
    } else {
      params.set("bibleId", pref.bibleId);
      if (pref.abbr) params.set("abbr", pref.abbr);
    }

    fetch(`/api/scripture?${params.toString()}`)
      .then((r) => r.json())
      .then((d: { text?: string; translation?: string; error?: string }) => {
        if (fetchCountRef.current !== myCount) return;
        if (d.error === "not_found") {
          setState({ status: "not_found" });
        } else if (d.error === "no_api_key" || d.error === "bad_api_key") {
          setState({ status: "no_translation" });
        } else if (d.error) {
          setState({ status: "error" });
        } else {
          setState({ status: "ok", text: d.text!, translation: d.translation! });
        }
      })
      .catch(() => {
        if (fetchCountRef.current === myCount) setState({ status: "error" });
      });
  }, [osisRef, locale]);

  // Position the tooltip after render so it stays within the viewport
  useEffect(() => {
    if (!tooltipEl.current) return;
    const el = tooltipEl.current;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const PADDING = 8;

    // Horizontal: centre on anchor, clamp to viewport edges
    let left = anchorPos.x - width / 2;
    if (left < PADDING) left = PADDING;
    if (left + width > vw - PADDING) left = vw - PADDING - width;

    // Vertical: prefer below anchor; flip above only when it fits better there
    const spaceBelow = vh - PADDING - anchorPos.y;
    const spaceAbove = anchorPos.y - 28 - PADDING; // 28 ≈ decorated text line height
    let top: number;
    if (height <= spaceBelow || spaceBelow >= spaceAbove) {
      top = anchorPos.y;
    } else {
      top = anchorPos.y - height - 28;
    }

    // Final clamp: never outside [PADDING, vh - PADDING - height]
    // When height ≥ vh - 2*PADDING the lower bound wins and tooltip pins to top
    top = Math.max(PADDING, Math.min(top, vh - PADDING - height));

    setStyle({ position: "fixed", left, top, visibility: "visible" });
  }, [state, anchorPos]);

  const handleCopy = useCallback(() => {
    if (state.status !== "ok") return;
    const label = `${formatRef(osisRef)} (${state.translation})`;
    navigator.clipboard.writeText(`${label}\n${state.text}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [state, osisRef]);

  const content = (
    <div
      ref={tooltipEl}
      className="scripture-tooltip"
      style={style}
      onMouseEnter={onCancelLeave}
      onMouseLeave={onClose}
    >
      <div className="scripture-tooltip-header">
        <span className="scripture-tooltip-ref">{formatRef(osisRef)}</span>
        <div className="scripture-tooltip-header-right">
          {state.status === "ok" && (
            <span className="scripture-tooltip-abbr">{state.translation}</span>
          )}
          {state.status === "ok" && (
            <button
              className="scripture-tooltip-copy"
              onClick={handleCopy}
              title={copied ? "Copied!" : "Copy verse"}
              onMouseEnter={onCancelLeave}
            >
              {copied ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="2,6 5,9 10,3"/>
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="1" width="7" height="8" rx="1"/>
                  <path d="M2 4H1.5A.5.5 0 0 0 1 4.5v6A.5.5 0 0 0 1.5 11H8a.5.5 0 0 0 .5-.5V10"/>
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
      <div className="scripture-tooltip-body">
        {state.status === "loading" && (
          <span className="scripture-tooltip-muted">{t("scriptureTooltip.loading")}</span>
        )}
        {state.status === "not_found" && (
          <span className="scripture-tooltip-muted">{t("scriptureTooltip.notFound")}</span>
        )}
        {state.status === "error" && (
          <span className="scripture-tooltip-muted">{t("scriptureTooltip.error")}</span>
        )}
        {state.status === "no_translation" && (
          <span className="scripture-tooltip-muted" style={{ userSelect: "none" }}>
            {t("scriptureTooltip.noTranslation")}
            <br />
            <span style={{ fontSize: "0.72rem" }}>{t("scriptureTooltip.configureApi")}</span>
          </span>
        )}
        {state.status === "ok" && <span>{state.text}</span>}
      </div>
    </div>
  );

  // Render into body to avoid clipping by overflow:hidden parents
  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}

// Convert "John.3.16" → "John 3:16", "Gen.1.1-Gen.1.3" → "Gen 1:1–3"
function formatRef(osisRef: string): string {
  const rangeParts = osisRef.split("-");
  const fmt = (part: string) => {
    const [book, ch, v] = part.split(".");
    if (!ch) return book;
    if (!v) return `${book} ${ch}`;
    return `${book} ${ch}:${v}`;
  };
  if (rangeParts.length === 1) return fmt(rangeParts[0]);
  const start = rangeParts[0].split(".");
  const end = rangeParts[1].split(".");
  // Same book+chapter: "Gen 1:1–3"
  if (start[0] === end[0] && start[1] === end[1]) {
    return `${start[0]} ${start[1]}:${start[2]}–${end[2]}`;
  }
  // Same book, different chapters: "Gen 1:1–2:3"
  if (start[0] === end[0]) {
    return `${start[0]} ${start[1]}:${start[2]}–${end[1]}:${end[2]}`;
  }
  return `${fmt(rangeParts[0])}–${fmt(rangeParts[1])}`;
}
