"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "@/lib/i18n/LocaleContext";

// localStorage keys for per-locale translation preferences
const PREF_KEY = (locale: string) => `scripture:tooltipTranslation:${locale}`;

export type TranslationPref =
  | { source: "local"; id: number; abbr?: string }
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
  const tooltipEl = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    left: anchorPos.x,
    top: anchorPos.y,
    visibility: "hidden", // hide until positioned
  });

  // Fetch verse text when the ref or locale changes
  useEffect(() => {
    setState({ status: "loading" });

    const pref = getTranslationPref(locale);
    if (!pref) {
      setState({ status: "no_translation" });
      return;
    }

    const params = new URLSearchParams({ ref: osisRef });
    if (pref.source === "local") {
      params.set("localId", String(pref.id));
    } else {
      params.set("bibleId", pref.bibleId);
    }

    const ac = new AbortController();
    fetch(`/api/scripture?${params.toString()}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((d: { text?: string; translation?: string; error?: string }) => {
        if (d.error === "not_found" || d.error === "no_api_key") {
          setState({ status: "not_found" });
        } else if (d.error) {
          setState({ status: "error" });
        } else {
          setState({ status: "ok", text: d.text!, translation: d.translation! });
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") setState({ status: "error" });
      });

    return () => ac.abort();
  }, [osisRef, locale]);

  // Position the tooltip after render so we can flip above viewport edge
  useEffect(() => {
    if (!tooltipEl.current) return;
    const el = tooltipEl.current;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const PADDING = 8;

    let left = anchorPos.x - width / 2;
    let top = anchorPos.y;

    // Clamp horizontally
    if (left < PADDING) left = PADDING;
    if (left + width > vw - PADDING) left = vw - PADDING - width;

    // Flip above if too close to bottom
    if (top + height > vh - PADDING) {
      top = anchorPos.y - height - 28; // 28 ≈ line height of decorated text
    }

    setStyle({ position: "fixed", left, top, visibility: "visible" });
  }, [state, anchorPos]);

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
        {state.status === "ok" && (
          <span className="scripture-tooltip-abbr">{state.translation}</span>
        )}
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
          <span className="scripture-tooltip-muted">{t("scriptureTooltip.noTranslation")}</span>
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
