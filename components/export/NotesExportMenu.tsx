"use client";

import { useState, useRef, useEffect } from "react";
import { tiptapToHtml, tiptapIsEmpty } from "@/lib/export/tiptap-utils";

interface Props {
  noteKeys: string[];
  title: string;
  filename: string;
}

type Status = "idle" | "loading" | "done" | "empty";

export default function NotesExportMenu({ noteKeys, title, filename }: Props) {
  const [open, setOpen] = useState(false);
  const [docxStatus, setDocxStatus] = useState<Status>("idle");
  const [odtStatus,  setOdtStatus]  = useState<Status>("idle");
  const [copyStatus, setCopyStatus] = useState<Status>("idle");
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function downloadDoc(format: "docx" | "odt", setStatus: (s: Status) => void) {
    if (setStatus === setDocxStatus && docxStatus === "loading") return;
    if (setStatus === setOdtStatus  && odtStatus  === "loading") return;
    setStatus("loading");
    setOpen(false);
    try {
      const res = await fetch("/api/export/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: noteKeys, title, format }),
      });
      if (res.status === 404) {
        setStatus("empty");
        setTimeout(() => setStatus("idle"), 3000);
        return;
      }
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const ext  = format === "docx" ? "docx" : "odt";
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `${filename}-notes.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus("done");
    } catch (err) {
      console.error("Notes export failed:", err);
      setStatus("idle");
    }
    setTimeout(() => setStatus("idle"), 2500);
  }

  async function copyToClipboard() {
    if (copyStatus === "loading") return;
    setCopyStatus("loading");
    setOpen(false);
    try {
      // Fetch raw note content from the notes API.
      const url = `/api/notes?keys=${encodeURIComponent(noteKeys.join(","))}`;
      const res = await fetch(url);
      const data: Record<string, { content: string }> = await res.json();

      // Check for any non-empty notes.
      const hasAny = noteKeys.some((k) => !tiptapIsEmpty(data[k]?.content ?? "{}"));
      if (!hasAny) {
        setCopyStatus("empty");
        setTimeout(() => setCopyStatus("idle"), 3000);
        return;
      }

      // Build HTML document.
      let html = `<h1>${esc(title)}</h1>\n`;
      for (const key of noteKeys) {
        const content = data[key]?.content ?? "{}";
        if (tiptapIsEmpty(content)) continue;
        const label = keyToLabel(key, noteKeys);
        html += `<h2>${esc(label)}</h2>\n${tiptapToHtml(content)}\n`;
      }

      // Plain text fallback: strip tags.
      const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html":  new Blob([html],  { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      setCopyStatus("done");
    } catch (err) {
      console.error("Clipboard write failed:", err);
      setCopyStatus("idle");
    }
    setTimeout(() => setCopyStatus("idle"), 2500);
  }

  function esc(s: string) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  const btnBase =
    "w-full text-left px-3 py-2 text-xs font-medium rounded transition-colors hover:bg-stone-100 dark:hover:bg-stone-700 flex items-center gap-2";

  const triggerLabel =
    docxStatus === "loading" ? "Exporting…" :
    odtStatus  === "loading" ? "Exporting…" :
    copyStatus === "loading" ? "Copying…"   :
    docxStatus === "done"    ? "✓ DOCX"     :
    odtStatus  === "done"    ? "✓ ODT"      :
    copyStatus === "done"    ? "✓ Copied"   :
    docxStatus === "empty" || odtStatus === "empty" || copyStatus === "empty"
                             ? "No notes"   :
                               "📝 Notes";

  const busy = docxStatus === "loading" || odtStatus === "loading" || copyStatus === "loading";

  return (
    <div ref={menuRef} className="relative">
      <button
        className="px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50 bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-200 dark:hover:bg-stone-700"
        onClick={() => !busy && setOpen((o) => !o)}
        disabled={busy}
        title="Export notes to Word, LibreOffice, or clipboard"
      >
        {triggerLabel} {!busy && "▾"}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-44 rounded-lg shadow-lg border z-50 py-1"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          <button
            className={btnBase}
            style={{ color: "var(--foreground)" }}
            onClick={() => downloadDoc("docx", setDocxStatus)}
          >
            <span>📄</span>
            <span>Word (.docx)</span>
          </button>
          <button
            className={btnBase}
            style={{ color: "var(--foreground)" }}
            onClick={() => downloadDoc("odt", setOdtStatus)}
          >
            <span>📄</span>
            <span>LibreOffice (.odt)</span>
          </button>
          <div
            className="my-1 border-t"
            style={{ borderColor: "var(--border)" }}
          />
          <button
            className={btnBase}
            style={{ color: "var(--foreground)" }}
            onClick={copyToClipboard}
          >
            <span>📋</span>
            <span>Copy to clipboard</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ── Key label helpers (mirrors logic in the API route) ────────────────────────

function keyToLabel(key: string, allKeys: string[]): string {
  const [type, ref] = key.split(":");
  if (!ref) return key;
  const parts = ref.split(".");

  // Count distinct chapters across all keys to decide multi-chapter mode.
  const chapters = new Set<number>();
  for (const k of allKeys) {
    const [t, r] = k.split(":");
    if (!r) continue;
    const ps = r.split(".");
    if (t === "chapter") { const c = parseInt(ps[ps.length - 1], 10); if (!isNaN(c)) chapters.add(c); }
    if (t === "verse" && ps.length >= 3) { const c = parseInt(ps[ps.length - 2], 10); if (!isNaN(c)) chapters.add(c); }
  }
  const multi = chapters.size > 1;

  switch (type) {
    case "passage": return "Passage Note";
    case "chapter": {
      const ch = parseInt(parts[parts.length - 1], 10);
      return isNaN(ch) ? "Chapter Note" : `Chapter ${ch}`;
    }
    case "verse": {
      const v  = parseInt(parts[parts.length - 1], 10);
      const ch = parseInt(parts[parts.length - 2], 10);
      if (multi && !isNaN(ch)) return `Chapter ${ch} · Verse ${v}`;
      return isNaN(v) ? "Verse" : `Verse ${v}`;
    }
    default:
      return key;
  }
}
