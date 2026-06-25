"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NoteEditor from "./NoteEditor";
import { extractTextFromTipTap, tiptapToHtml } from "@/lib/utils/tiptap-text";

interface CustomField {
  id: string;
  name: string;
  value: string;
}

interface SummaryMeta {
  mainIdea: string;
  customFields: CustomField[];
}

function parseMeta(content: string): SummaryMeta {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !parsed.type) {
      return {
        mainIdea: typeof parsed.mainIdea === "string" ? parsed.mainIdea : "",
        customFields: Array.isArray(parsed.customFields) ? parsed.customFields : [],
      };
    }
  } catch {
    /* ignore */
  }
  return { mainIdea: "", customFields: [] };
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

interface ChapterSummarySectionProps {
  /** Key for the meta blob (main idea + custom fields). e.g. "meta:chapter:Gen.1" */
  metaKey: string;
  /** Key for the sermon outline TipTap note. e.g. "sermon:chapter:Gen.1" */
  sermonKey: string;
  /** For passing to NoteEditor */
  book?: string;
  chapter?: number;
  /** Current search query (passed to sermon NoteEditor for highlighting) */
  searchQuery?: string;
}

export default function ChapterSummarySection({
  metaKey,
  sermonKey,
  book,
  chapter,
  searchQuery,
}: ChapterSummarySectionProps) {
  const [meta, setMeta] = useState<SummaryMeta>({ mainIdea: "", customFields: [] });
  const [sermonContent, setSermonContent] = useState<string>("{}");
  const [loaded, setLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load both keys on mount / key change
  useEffect(() => {
    setLoaded(false);
    const keys = [metaKey, sermonKey].join(",");
    fetch(`/api/notes?keys=${encodeURIComponent(keys)}`)
      .then((r) => r.json())
      .then((data: Record<string, { content: string }>) => {
        setMeta(parseMeta(data[metaKey]?.content ?? "{}"));
        setSermonContent(data[sermonKey]?.content ?? "{}");
        setLoaded(true);
      })
      .catch(() => {
        setMeta({ mainIdea: "", customFields: [] });
        setSermonContent("{}");
        setLoaded(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaKey, sermonKey]);

  const saveMeta = useCallback(
    (updated: SummaryMeta) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          await fetch("/api/notes", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: metaKey,
              noteType: "meta",
              content: JSON.stringify(updated),
              book,
              chapter,
            }),
          });
        } catch {
          /* silent */
        }
      }, 500);
    },
    [metaKey, book, chapter]
  );

  function updateMainIdea(value: string) {
    const updated = { ...meta, mainIdea: value };
    setMeta(updated);
    saveMeta(updated);
  }

  function addCustomField() {
    const updated = {
      ...meta,
      customFields: [...meta.customFields, { id: genId(), name: "Field", value: "" }],
    };
    setMeta(updated);
    saveMeta(updated);
  }

  function updateFieldName(id: string, name: string) {
    const updated = {
      ...meta,
      customFields: meta.customFields.map((f) => (f.id === id ? { ...f, name } : f)),
    };
    setMeta(updated);
    saveMeta(updated);
  }

  function updateFieldValue(id: string, value: string) {
    const updated = {
      ...meta,
      customFields: meta.customFields.map((f) => (f.id === id ? { ...f, value } : f)),
    };
    setMeta(updated);
    saveMeta(updated);
  }

  async function copyOverview() {
    // Re-fetch the sermon content at copy time so we get the latest saved version
    let latestSermon = sermonContent;
    try {
      const res = await fetch(`/api/notes?keys=${encodeURIComponent(sermonKey)}`);
      const data = await res.json() as Record<string, { content: string }>;
      latestSermon = data[sermonKey]?.content ?? sermonContent;
    } catch { /* use cached */ }

    const sections: Array<{ label: string; text: string; html: string }> = [];

    if (meta.mainIdea.trim()) {
      sections.push({ label: "Main Idea", text: meta.mainIdea.trim(), html: `<p>${meta.mainIdea.trim()}</p>` });
    }

    const outlineText = extractTextFromTipTap(latestSermon);
    const outlineHtml = tiptapToHtml(latestSermon);
    if (outlineText) {
      sections.push({ label: "Teaching Outline", text: outlineText, html: outlineHtml });
    }

    for (const field of meta.customFields) {
      if (field.value.trim()) {
        sections.push({ label: field.name, text: field.value.trim(), html: `<p>${field.value.trim()}</p>` });
      }
    }

    if (sections.length === 0) return;

    const plainText = sections.map((s) => `${s.label}\n${s.text}`).join("\n\n");
    const html = sections
      .map((s) => `<h3>${s.label}</h3>${s.html}`)
      .join("");

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([plainText], { type: "text/plain" }),
          "text/html":  new Blob([`<div>${html}</div>`], { type: "text/html" }),
        }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback to plain text
      await navigator.clipboard.writeText(plainText).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function removeField(id: string) {
    const updated = {
      ...meta,
      customFields: meta.customFields.filter((f) => f.id !== id),
    };
    setMeta(updated);
    saveMeta(updated);
  }

  const inputCls =
    "w-full text-xs px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-amber-400";

  return (
    <div className="border-b border-stone-200 dark:border-stone-700">
      {/* Section header */}
      <div className="flex items-center px-4 pt-3 pb-2">
        <button
          className="flex-1 flex items-center gap-2 text-left select-none"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
        >
          <span
            className="text-xs font-bold tracking-wide uppercase"
            style={{ color: "var(--accent)" }}
          >
            Overview
          </span>
          <span className="text-stone-400 dark:text-stone-500 text-xs">
            {collapsed ? "▶" : "▼"}
          </span>
        </button>
        {loaded && (
          <button
            onClick={copyOverview}
            title="Copy overview to clipboard"
            className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
            style={{ color: copied ? "var(--accent)" : "var(--text-muted)" }}
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-4">
          {!loaded ? (
            <p className="text-xs text-stone-400 dark:text-stone-500">Loading…</p>
          ) : (
            <>
              {/* Main Idea */}
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-muted)" }}>
                  Main Idea
                </label>
                <input
                  type="text"
                  value={meta.mainIdea}
                  onChange={(e) => updateMainIdea(e.target.value)}
                  placeholder="Summarize the main idea…"
                  className={inputCls}
                />
              </div>

              {/* Sermon Outline */}
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-muted)" }}>
                  Teaching Outline
                </label>
                <div className="rounded border border-[var(--border)] overflow-hidden">
                  <NoteEditor
                    key={sermonKey}
                    noteKey={sermonKey}
                    noteType="sermon"
                    initialContent={sermonContent}
                    book={book}
                    chapter={chapter}
                    searchQuery={searchQuery}
                  />
                </div>
              </div>

              {/* Custom Fields */}
              {meta.customFields.length > 0 && (
                <div className="space-y-3">
                  {meta.customFields.map((field) => (
                    <div key={field.id}>
                      <div className="flex items-center gap-1 mb-1">
                        <input
                          type="text"
                          value={field.name}
                          onChange={(e) => updateFieldName(field.id, e.target.value)}
                          className="flex-1 text-xs px-2 py-1 rounded border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] font-semibold focus:outline-none focus:ring-1 focus:ring-amber-400"
                        />
                        <button
                          onClick={() => removeField(field.id)}
                          title="Remove field"
                          className="w-5 h-5 flex items-center justify-center rounded text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors text-xs shrink-0"
                        >
                          ×
                        </button>
                      </div>
                      <textarea
                        value={field.value}
                        onChange={(e) => updateFieldValue(field.id, e.target.value)}
                        placeholder={`${field.name} content…`}
                        rows={3}
                        className={`${inputCls} resize-y`}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Add custom field button */}
              <button
                onClick={addCustomField}
                className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
              >
                <span className="text-base leading-none">+</span>
                <span>Add custom field</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
