"use client";

import { useState, useRef, useEffect } from "react";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/translations";
import { useTranslation } from "@/lib/i18n/LocaleContext";

export default function LanguagePicker() {
  const { locale, setLocale } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Interface language"
        className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
        style={{ color: "var(--nav-fg)" }}
      >
        🌐 {locale.toUpperCase()}
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 rounded-lg border shadow-lg py-1 min-w-[140px]"
          style={{
            backgroundColor: "var(--surface)",
            borderColor: "var(--border)",
            color: "var(--foreground)",
          }}
        >
          {LOCALES.map((l: Locale) => (
            <button
              key={l}
              onClick={() => { setLocale(l); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-muted)]"
              style={{
                fontWeight: l === locale ? 600 : 400,
                color: l === locale ? "var(--accent)" : "var(--foreground)",
              }}
            >
              {LOCALE_LABELS[l]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
