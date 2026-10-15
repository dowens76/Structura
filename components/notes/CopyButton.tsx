"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n/LocaleContext";

export interface CopyPayload {
  html: string;
  plain: string;
}

/** Writes rich HTML + plain-text fallback; falls back to plain text only. */
export async function writeRichClipboard({ html, plain }: CopyPayload): Promise<void> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html":  new Blob([html],  { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      }),
    ]);
  } catch {
    await navigator.clipboard.writeText(plain).catch(() => {});
  }
}

export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain user text (an input/textarea value) → HTML paragraph, keeping line breaks. */
export function plainToHtml(text: string): string {
  return `<p>${escHtml(text.trim()).replace(/\n/g, "<br>")}</p>`;
}

interface CopyButtonProps {
  /** Built at click time so it reflects the latest content; null = nothing to copy. */
  getPayload: () => CopyPayload | null;
  /** Tooltip / aria-label for the idle state. */
  label: string;
  disabled?: boolean;
  className?: string;
}

/** Small clipboard icon button with ✓ / "nothing to copy" feedback. */
export default function CopyButton({ getPayload, label, disabled, className = "" }: CopyButtonProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"idle" | "copied" | "empty">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  async function handleClick() {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    const payload = getPayload();
    if (!payload) {
      setStatus("empty");
    } else {
      await writeRichClipboard(payload);
      setStatus("copied");
    }
    resetTimer.current = setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      // Keep focus (and selection) in an editor when clicking from its toolbar
      onMouseDown={(e) => e.preventDefault()}
      disabled={disabled}
      title={
        status === "copied" ? t("notes.copied")
        : status === "empty" ? t("notes.nothingToCopy")
        : label
      }
      aria-label={label}
      className={[
        "w-6 h-6 flex items-center justify-center rounded transition-colors shrink-0 disabled:opacity-30",
        status === "copied"
          ? "text-emerald-600 dark:text-emerald-400"
          : status === "empty"
            ? "text-stone-300 dark:text-stone-600"
            : "text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800",
        className,
      ].join(" ")}
    >
      {status === "copied" ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"
             strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <path d="M3 8.5l3 3 7-7" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
             strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <rect x="5" y="5" width="9" height="9" rx="1.5" />
          <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
        </svg>
      )}
    </button>
  );
}
