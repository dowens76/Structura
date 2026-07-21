"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import HomeLink from "@/components/ui/HomeLink";

const HEBREW_FONT: React.CSSProperties = { fontFamily: '"Ezra SIL", "SBL Hebrew", serif' };
function isHebrew(s: string): boolean { return /[א-ת]/.test(s); }
function hebrewStyle(s: string): React.CSSProperties { return isHebrew(s) ? HEBREW_FONT : {}; }

const OPTION_PALETTE = ["#b91c1c", "#c2410c", "#a16207", "#166534", "#0f766e", "#1d4ed8", "#6d28d9", "#be185d"];
function colorForIndex(i: number): string { return OPTION_PALETTE[i % OPTION_PALETTE.length]; }

// Shared with ChapterDisplay's "hide source text" toggle so the preference
// is consistent across the reading view and this editor.
function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function writeLocal<T>(key: string, value: T): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota exceeded */ }
}

interface ColumnOption { id: number; value: string; color: string | null; sortOrder: number }
interface Column { id: number; tagName: string; name: string; type: "text" | "list"; sortOrder: number; options?: ColumnOption[] }
interface OccurrenceValue { optionIds: number[]; text: string | null }
interface Occurrence {
  wordId: string; book: string; chapter: number; verse: number;
  reference: string; sourceText: string; translationText: string;
  values: Record<number, OccurrenceValue>;
}
interface TranslationInfo { id: number; abbreviation: string; name: string }
interface TagInfo { name: string; type: string; color: string; books: string[] }
interface OccurrencesData { tag: TagInfo; translationOnly: boolean; translations: TranslationInfo[]; columns: Column[]; occurrences: Occurrence[] }

function typeBadge(type: string): string {
  if (type === "word" || type === "cluster") return "L";
  if (type === "search") return "S";
  return "C";
}

export default function ConceptEditorPanel({ tagName }: { tagName: string }) {
  const [data, setData] = useState<OccurrencesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [translationId, setTranslationId] = useState<number | null>(null);
  const [hideSourceText, setHideSourceText] = useState(false);
  const hideSourceInitialized = useRef(false);

  const load = useCallback(async (transId: number | null) => {
    setError(null);
    try {
      const qs = new URLSearchParams({ tagName });
      if (transId != null) qs.set("translationId", String(transId));
      const res = await fetch(`/api/word-tags/occurrences?${qs.toString()}`);
      if (!res.ok) throw new Error("Failed to load");
      const d: OccurrencesData = await res.json();
      if (transId == null && d.translations.length > 0) {
        // No translation selected yet — pick the first one and refetch with
        // it so the Translation Text column is populated on first load.
        setTranslationId(d.translations[0].id);
        await load(d.translations[0].id);
        return;
      }
      if (!hideSourceInitialized.current) {
        hideSourceInitialized.current = true;
        // In a Translation Only workspace, default to hiding source text —
        // same precedent as ChapterDisplay's hideSourceText — but still let
        // the user toggle it back on, and respect any stored preference.
        setHideSourceText(d.translationOnly || readLocal<boolean>("structura:hideSourceText", false));
      }
      setData(d);
    } catch {
      setError("Failed to load this list.");
    } finally {
      setLoading(false);
    }
  }, [tagName]);

  useEffect(() => { load(null); }, [load]);

  function handleTranslationChange(id: number) {
    setTranslationId(id);
    load(id);
  }

  function toggleSourceText() {
    setHideSourceText((prev) => {
      const next = !prev;
      writeLocal("structura:hideSourceText", next);
      return next;
    });
  }

  async function refresh() {
    await load(translationId);
  }

  async function handleAddColumn(name: string, type: "text" | "list") {
    await fetch("/api/word-tags/columns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagName, name, type }),
    });
    await refresh();
  }

  async function handleRenameColumn(columnId: number, name: string) {
    await fetch(`/api/word-tags/columns/${columnId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await refresh();
  }

  async function handleDeleteColumn(columnId: number) {
    await fetch(`/api/word-tags/columns/${columnId}`, { method: "DELETE" });
    await refresh();
  }

  async function handleReorderColumns(orderedIds: number[]) {
    await Promise.all(orderedIds.map((id, idx) =>
      fetch(`/api/word-tags/columns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: idx }),
      })
    ));
    await refresh();
  }

  async function handleToggleOption(columnId: number, wordId: string, optionId: number, currentlySelected: boolean) {
    if (currentlySelected) {
      await fetch(`/api/word-tags/columns/${columnId}/values`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, optionId }),
      });
    } else {
      await fetch(`/api/word-tags/columns/${columnId}/values`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, optionId }),
      });
    }
    await refresh();
  }

  async function handleCreateOption(columnId: number, wordId: string, value: string) {
    const res = await fetch(`/api/word-tags/columns/${columnId}/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    const opt = await res.json();
    await fetch(`/api/word-tags/columns/${columnId}/values`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wordId, optionId: opt.id }),
    });
    await refresh();
  }

  async function handleSetText(columnId: number, wordId: string, textValue: string) {
    await fetch(`/api/word-tags/columns/${columnId}/values`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wordId, textValue }),
    });
  }

  if (loading) {
    return <div className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</div>;
  }
  if (error) {
    return <div className="text-sm text-red-500">{error}</div>;
  }
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-4 mb-4">
          <HomeLink />
          <Link
            href="/export/lists"
            className="flex items-center gap-1.5 text-sm transition-colors hover:opacity-70 w-fit"
            style={{ color: "var(--text-muted)" }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to Manage Lists
          </Link>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: data.tag.color }} />
          <h1 className="text-2xl font-semibold" style={{ color: "var(--foreground)", ...hebrewStyle(data.tag.name) }}>
            {data.tag.name}
          </h1>
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-50" style={{ color: data.tag.color }}>
            {typeBadge(data.tag.type)}
          </span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {data.tag.books.join(", ")} · {data.occurrences.length} occurrence{data.occurrences.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>Translation:</span>
          <select
            value={translationId ?? ""}
            onChange={(e) => handleTranslationChange(parseInt(e.target.value))}
            className="text-xs px-2 py-1 rounded border"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
          >
            {data.translations.length === 0 && <option value="">No translations imported</option>}
            {data.translations.map((t) => (
              <option key={t.id} value={t.id}>{t.abbreviation} — {t.name}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "var(--text-muted)" }}>
          <input type="checkbox" checked={!hideSourceText} onChange={toggleSourceText} />
          Show source text
        </label>
      </div>

      <OccurrenceTable
        data={data}
        showSourceText={!hideSourceText}
        onAddColumn={handleAddColumn}
        onRenameColumn={handleRenameColumn}
        onDeleteColumn={handleDeleteColumn}
        onReorderColumns={handleReorderColumns}
        onToggleOption={handleToggleOption}
        onCreateOption={handleCreateOption}
        onSetText={handleSetText}
      />
    </div>
  );
}

// ─── Occurrence table ───────────────────────────────────────────────────────

interface OccurrenceTableProps {
  data: OccurrencesData;
  showSourceText: boolean;
  onAddColumn: (name: string, type: "text" | "list") => Promise<void>;
  onRenameColumn: (columnId: number, name: string) => Promise<void>;
  onDeleteColumn: (columnId: number) => Promise<void>;
  onReorderColumns: (orderedIds: number[]) => Promise<void>;
  onToggleOption: (columnId: number, wordId: string, optionId: number, currentlySelected: boolean) => Promise<void>;
  onCreateOption: (columnId: number, wordId: string, value: string) => Promise<void>;
  onSetText: (columnId: number, wordId: string, textValue: string) => Promise<void>;
}

function OccurrenceTable({
  data, showSourceText, onAddColumn, onRenameColumn, onDeleteColumn, onReorderColumns, onToggleOption, onCreateOption, onSetText,
}: OccurrenceTableProps) {
  const [showAddColumn, setShowAddColumn] = useState(false);
  const dragIdx = useRef<number | null>(null);
  const [dragOrder, setDragOrder] = useState<number[] | null>(null);

  const columns = dragOrder
    ? dragOrder.map((id) => data.columns.find((c) => c.id === id)!).filter(Boolean)
    : data.columns;

  function handleDragStart(idx: number) {
    dragIdx.current = idx;
    setDragOrder(data.columns.map((c) => c.id));
  }
  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx || !dragOrder) return;
    const next = [...dragOrder];
    const [moved] = next.splice(dragIdx.current, 1);
    next.splice(idx, 0, moved);
    dragIdx.current = idx;
    setDragOrder(next);
  }
  async function handleDragEnd() {
    dragIdx.current = null;
    if (dragOrder) await onReorderColumns(dragOrder);
    setDragOrder(null);
  }

  return (
    <div className="rounded-lg border overflow-x-auto" style={{ borderColor: "var(--border)" }}>
      <table className="min-w-full text-xs border-collapse">
        <thead>
          <tr style={{ backgroundColor: "var(--surface-muted, var(--surface))" }}>
            <th className="text-left px-3 py-2 font-semibold whitespace-nowrap" style={{ color: "var(--foreground)" }}>Reference</th>
            {showSourceText && (
              <th className="text-left px-3 py-2 font-semibold whitespace-nowrap" style={{ color: "var(--foreground)" }}>Source Text</th>
            )}
            <th className="text-left px-3 py-2 font-semibold whitespace-nowrap" style={{ color: "var(--foreground)" }}>Translation Text</th>
            {columns.map((col, idx) => (
              <th
                key={col.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={handleDragEnd}
                className="text-left px-3 py-2 font-semibold whitespace-nowrap cursor-grab active:cursor-grabbing select-none"
                style={{ color: "var(--foreground)" }}
              >
                <ColumnHeader column={col} onRename={onRenameColumn} onDelete={onDeleteColumn} />
              </th>
            ))}
            <th className="px-3 py-2 whitespace-nowrap relative">
              {!showAddColumn ? (
                <button type="button" onClick={() => setShowAddColumn(true)}
                  className="text-xs px-2 py-1 rounded border border-dashed transition-colors hover:border-blue-400 hover:text-blue-500"
                  style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                  + Column
                </button>
              ) : (
                <AddColumnForm
                  onSave={async (name, type) => { await onAddColumn(name, type); setShowAddColumn(false); }}
                  onCancel={() => setShowAddColumn(false)}
                />
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.occurrences.map((occ) => (
            <tr key={occ.wordId} className="border-t" style={{ borderColor: "var(--border)" }}>
              <td className="px-3 py-2 whitespace-nowrap align-top" style={{ color: "var(--foreground)" }}>{occ.reference}</td>
              {showSourceText && (
                <td className="px-3 py-2 align-top" style={hebrewStyle(occ.sourceText)}>{occ.sourceText}</td>
              )}
              <td className="px-3 py-2 align-top" style={{ color: "var(--text-muted)" }}>{occ.translationText}</td>
              {columns.map((col) => (
                <td key={col.id} className="px-3 py-2 align-top" style={{ minWidth: "10rem" }}>
                  {col.type === "list" ? (
                    <ListCell
                      column={col}
                      value={occ.values[col.id] ?? { optionIds: [], text: null }}
                      onToggleOption={(optionId, selected) => onToggleOption(col.id, occ.wordId, optionId, selected)}
                      onCreateOption={(value) => onCreateOption(col.id, occ.wordId, value)}
                    />
                  ) : (
                    <TextCell
                      initialValue={occ.values[col.id]?.text ?? ""}
                      onSave={(text) => onSetText(col.id, occ.wordId, text)}
                    />
                  )}
                </td>
              ))}
              <td />
            </tr>
          ))}
          {data.occurrences.length === 0 && (
            <tr>
              <td colSpan={(showSourceText ? 3 : 2) + columns.length + 1} className="px-3 py-6 text-center" style={{ color: "var(--text-muted)" }}>
                No occurrences found for this list.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Column header (rename / delete) ────────────────────────────────────────

function ColumnHeader({
  column, onRename, onDelete,
}: { column: Column; onRename: (id: number, name: string) => Promise<void>; onDelete: (id: number) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(column.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === "Enter" && name.trim()) { await onRename(column.id, name.trim()); setEditing(false); }
            if (e.key === "Escape") { setName(column.name); setEditing(false); }
          }}
          className="w-24 text-xs bg-transparent outline-none border-b"
          style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 group">
      <span onDoubleClick={() => setEditing(true)} title="Double-click to rename">{column.name}</span>
      {confirmDelete ? (
        <>
          <span role="button" className="text-green-600 dark:text-green-400 font-bold text-xs px-0.5" onClick={() => onDelete(column.id)}>✓</span>
          <span role="button" className="text-stone-400 text-xs px-0.5" onClick={() => setConfirmDelete(false)}>✕</span>
        </>
      ) : (
        <span
          role="button"
          onClick={() => setConfirmDelete(true)}
          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-stone-400 hover:text-red-500 transition-opacity leading-none"
          title="Delete column"
        >
          ×
        </span>
      )}
    </div>
  );
}

// ─── Add column form ─────────────────────────────────────────────────────────

function AddColumnForm({ onSave, onCancel }: { onSave: (name: string, type: "text" | "list") => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"text" | "list">("list");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try { await onSave(name.trim(), type); } finally { setSaving(false); }
  }

  return (
    <div className="absolute z-50 mt-1 rounded-lg border shadow-lg p-3 w-56"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onCancel(); }}
        placeholder="Column name"
        className="w-full text-xs px-2 py-1 rounded border mb-2"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--foreground)" }}
      />
      <div className="flex rounded overflow-hidden border text-xs mb-2" style={{ borderColor: "var(--border)" }}>
        {(["list", "text"] as const).map((tp) => (
          <button key={tp} type="button" onClick={() => setType(tp)}
            className="flex-1 px-2 py-1 capitalize transition-colors"
            style={{ backgroundColor: type === tp ? "var(--accent)" : "transparent", color: type === tp ? "#fff" : "var(--text-muted)" }}>
            {tp === "list" ? "List" : "Text"}
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-xs px-2 py-0.5 rounded" style={{ color: "var(--text-muted)" }}>Cancel</button>
        <button type="button" onClick={handleSave} disabled={saving || !name.trim()}
          className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
}

// ─── List-type cell ──────────────────────────────────────────────────────────

function ListCell({
  column, value, onToggleOption, onCreateOption,
}: {
  column: Column;
  value: OccurrenceValue;
  onToggleOption: (optionId: number, currentlySelected: boolean) => Promise<void>;
  onCreateOption: (value: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const options = column.options ?? [];
  const selected = new Set(value.optionIds);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const filtered = options.filter((o) => o.value.toLowerCase().includes(query.trim().toLowerCase()));
  const exactMatch = options.some((o) => o.value.toLowerCase() === query.trim().toLowerCase());

  async function handleCreate() {
    if (!query.trim() || busy) return;
    setBusy(true);
    try { await onCreateOption(query.trim()); setQuery(""); } finally { setBusy(false); }
  }

  return (
    <div className="relative" ref={ref}>
      <div className="flex flex-wrap gap-1 items-center">
        {[...selected].map((optId) => {
          const opt = options.find((o) => o.id === optId);
          if (!opt) return null;
          const idx = options.findIndex((o) => o.id === optId);
          const color = opt.color ?? colorForIndex(idx);
          return (
            <span key={optId} className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border"
              style={{ borderColor: color, color: "var(--foreground)", ...hebrewStyle(opt.value) }}>
              {opt.value}
              <button type="button" onClick={() => onToggleOption(optId, true)} className="opacity-50 hover:opacity-100 leading-none">×</button>
            </span>
          );
        })}
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="text-[10px] px-1.5 py-0.5 rounded-full border border-dashed transition-colors hover:border-blue-400 hover:text-blue-500"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          +
        </button>
      </div>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 rounded-lg border shadow-lg p-2 w-48"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !exactMatch) handleCreate(); }}
            placeholder="Search or create…"
            className="w-full text-xs px-1.5 py-1 rounded border mb-1.5"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--foreground)" }}
          />
          <div className="max-h-40 overflow-y-auto flex flex-col gap-0.5">
            {filtered.map((opt) => {
              const idx = options.findIndex((o) => o.id === opt.id);
              const color = opt.color ?? colorForIndex(idx);
              const isSelected = selected.has(opt.id);
              return (
                <button key={opt.id} type="button"
                  onClick={() => onToggleOption(opt.id, isSelected)}
                  className="flex items-center gap-1.5 text-left text-xs px-1.5 py-1 rounded transition-colors hover:bg-stone-100 dark:hover:bg-stone-800"
                  style={{ color: "var(--foreground)" }}>
                  <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="flex-1 truncate" style={hebrewStyle(opt.value)}>{opt.value}</span>
                  {isSelected && <span className="text-[10px] opacity-60">✓</span>}
                </button>
              );
            })}
            {query.trim() && !exactMatch && (
              <button type="button" onClick={handleCreate} disabled={busy}
                className="text-left text-xs px-1.5 py-1 rounded transition-colors hover:bg-stone-100 dark:hover:bg-stone-800"
                style={{ color: "var(--accent)" }}>
                + Create &ldquo;{query.trim()}&rdquo;
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Text-type cell ──────────────────────────────────────────────────────────

function TextCell({ initialValue, onSave }: { initialValue: string; onSave: (text: string) => Promise<void> }) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => { setValue(initialValue); }, [initialValue]);

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => { if (value !== initialValue) onSave(value); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="w-full text-xs bg-transparent outline-none border-b py-0.5"
      style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
    />
  );
}
