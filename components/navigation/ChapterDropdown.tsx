"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";

interface Props {
  chapter: number;
  chapterCount: number;
  osisBook: string;
  textSource: string;
}

export default function ChapterDropdown({ chapter, chapterCount, osisBook, textSource }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, handleClickOutside]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors"
        style={{ color: "var(--nav-fg-muted)" }}
        title="Jump to chapter"
      >
        <span>Ch. {chapter}</span>
        <span className="text-[10px] opacity-60">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 w-64 rounded-lg shadow-xl border z-50 overflow-hidden"
          style={{ backgroundColor: "var(--background)", borderColor: "var(--border)" }}
        >
          <div className="max-h-56 overflow-y-auto p-2">
            <div className="grid grid-cols-10 gap-1">
              {Array.from({ length: chapterCount }, (_, i) => i + 1).map((ch) => {
                const isCurrent = ch === chapter;
                return (
                  <Link
                    key={ch}
                    href={`/${encodeURIComponent(osisBook)}/${textSource}/${ch}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-center rounded text-xs py-1 transition-colors hover:opacity-80"
                    style={
                      isCurrent
                        ? { backgroundColor: "var(--accent)", color: "#fff", fontWeight: 600 }
                        : { color: "var(--foreground)" }
                    }
                  >
                    {ch}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
