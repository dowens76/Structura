"use client";

import { useState, useRef, useEffect } from "react";

export type ImagePreset = "presentation" | "hifi" | "print";

interface Props {
  onExport: (preset: ImagePreset) => void;
  status: "idle" | "loading" | "done" | "error";
}

const PRESETS: {
  id: ImagePreset;
  icon: string;
  label: string;
  sub: string;
  title: string;
}[] = [
  {
    id: "presentation",
    icon: "🖥",
    label: "Presentation",
    sub: "PNG · 1× · compact file",
    title: "PNG optimised for slides and screen use (1× pixel ratio, smaller file size)",
  },
  {
    id: "hifi",
    icon: "🖼",
    label: "High-Fidelity",
    sub: "PNG · 144 PPI · Retina-ready",
    title: "Full-colour PNG at 144 PPI — crisp on HiDPI / Retina displays",
  },
  {
    id: "print",
    icon: "🖨",
    label: "Print-Ready",
    sub: "TIFF · CMYK · 300 DPI",
    title: "Uncompressed TIFF in CMYK colour space at 300 DPI for print production",
  },
];

export default function ImageExportMenu({ onExport, status }: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const busy = status === "loading";

  const triggerLabel =
    status === "loading" ? "Rendering…" :
    status === "done"    ? "✓ Image"    :
    status === "error"   ? "✗ Failed"   :
    "🖼 Image";

  const triggerClass = [
    "px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50",
    status === "error"
      ? "bg-red-600 text-white"
      : "bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-200 dark:hover:bg-stone-700",
  ].join(" ");

  return (
    <div ref={menuRef} className="relative">
      <button
        className={triggerClass}
        onClick={() => !busy && setOpen(o => !o)}
        disabled={busy}
        title="Export as image"
      >
        {triggerLabel} {!busy && "▾"}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-52 rounded-lg shadow-lg border z-50 py-1"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          {PRESETS.map(p => (
            <button
              key={p.id}
              className="w-full text-left px-3 py-2 text-xs rounded transition-colors hover:bg-stone-100 dark:hover:bg-stone-700 flex items-start gap-2"
              style={{ color: "var(--foreground)" }}
              title={p.title}
              onClick={() => {
                setOpen(false);
                onExport(p.id);
              }}
            >
              <span className="mt-0.5 text-base leading-none">{p.icon}</span>
              <span>
                <span className="block font-semibold">{p.label}</span>
                <span
                  className="block text-[10px] mt-0.5"
                  style={{ color: "var(--text-muted)" }}
                >
                  {p.sub}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
