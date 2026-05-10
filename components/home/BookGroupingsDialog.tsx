"use client";

import { useState, useEffect, useRef } from "react";
import type { Book } from "@/lib/db/schema";
import type { BookGrouping } from "@/lib/db/schema";
import { OSIS_BOOK_NAMES } from "@/lib/utils/osis";

// ── Annotation features that can be toggled per grouping ─────────────────────

export const GROUPING_FEATURES: { key: string; label: string }[] = [
  { key: "sectionHeadings", label: "Section Headings / Outline" },
  { key: "paragraphBreaks", label: "Paragraph Breaks" },
  { key: "characters",      label: "Characters & Speech" },
  { key: "wordTags",        label: "Word / Concept Tags" },
  { key: "rstRelations",    label: "RST Relations" },
  { key: "wordArrows",      label: "Word Arrows" },
  { key: "lineIndents",     label: "Poetic Line Indents" },
  { key: "clauseRelations", label: "Clause Relationships" },
  { key: "lineAnnotations", label: "Line Annotations" },
  { key: "translation",     label: "Translation Text" },
];

// ── Helper ────────────────────────────────────────────────────────────────────

function parseJson<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

// ── Sub-component: grouping editor (create or edit) ───────────────────────────

interface EditorProps {
  otBooks: Book[];
  ntBooks: Book[];
  lxxBooks: Book[];
  initial?: BookGrouping | null;
  onSave: (name: string, books: string[], features: string[]) => Promise<void>;
  onCancel: () => void;
}

function GroupingEditor({ otBooks, ntBooks, lxxBooks, initial, onSave, onCancel }: EditorProps) {
  const [name,          setName]          = useState(initial?.name ?? "");
  const [selectedBooks, setSelectedBooks] = useState<Set<string>>(
    () => new Set(parseJson<string[]>(initial?.books ?? "[]", []))
  );
  const [selectedFeats, setSelectedFeats] = useState<Set<string>>(
    () => new Set(parseJson<string[]>(initial?.features ?? "[]", []))
  );
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  function toggleBook(code: string) {
    setSelectedBooks(prev => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  function toggleFeature(key: string) {
    setSelectedFeats(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleAll(books: Book[]) {
    const codes = books.map(b => b.osisCode);
    const allOn = codes.every(c => selectedBooks.has(c));
    setSelectedBooks(prev => {
      const next = new Set(prev);
      if (allOn) codes.forEach(c => next.delete(c));
      else       codes.forEach(c => next.add(c));
      return next;
    });
  }

  async function handleSave() {
    if (!name.trim()) { setError("Name is required."); return; }
    setError(null);
    setSaving(true);
    try {
      await onSave(name.trim(), [...selectedBooks], [...selectedFeats]);
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    backgroundColor: "var(--background)",
    borderColor: "var(--border)",
    color: "var(--foreground)",
  };

  function BookSection({ books, label }: { books: Book[]; label: string }) {
    if (books.length === 0) return null;
    const allOn = books.every(b => selectedBooks.has(b.osisCode));
    return (
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{label}</span>
          <button
            type="button"
            onClick={() => toggleAll(books)}
            className="text-[10px] px-1.5 py-0.5 rounded border transition-colors"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            {allOn ? "Deselect all" : "Select all"}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {books.map(b => {
            const on = selectedBooks.has(b.osisCode);
            return (
              <button
                key={b.osisCode}
                type="button"
                onClick={() => toggleBook(b.osisCode)}
                className="text-[11px] px-2 py-1 rounded border transition-colors"
                style={{
                  borderColor: on ? "var(--accent)" : "var(--border)",
                  backgroundColor: on ? "rgba(200,155,60,0.12)" : "var(--surface)",
                  color: on ? "var(--accent)" : "var(--foreground)",
                  fontWeight: on ? 600 : 400,
                }}
                title={OSIS_BOOK_NAMES[b.osisCode] ?? b.osisCode}
              >
                {b.osisCode}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Name */}
      <div className="space-y-1">
        <label className="block text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Grouping name
        </label>
        <input
          ref={nameRef}
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onCancel(); }}
          placeholder="e.g. Samuel–Kings, Pentateuch…"
          className="w-full px-3 py-1.5 rounded border text-sm"
          style={inputStyle}
        />
      </div>

      {/* Books */}
      <div className="space-y-1">
        <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
          Books included
        </div>
        <div
          className="rounded border p-3 max-h-52 overflow-y-auto space-y-2"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
        >
          <BookSection books={otBooks}  label="Hebrew OT" />
          <BookSection books={ntBooks}  label="Greek NT" />
          <BookSection books={lxxBooks} label="LXX" />
        </div>
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {selectedBooks.size} book{selectedBooks.size !== 1 ? "s" : ""} selected
        </p>
      </div>

      {/* Features */}
      <div className="space-y-1">
        <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
          Annotation features
        </div>
        <div
          className="rounded border p-3 grid grid-cols-2 gap-x-4 gap-y-2"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
        >
          {GROUPING_FEATURES.map(f => {
            const on = selectedFeats.has(f.key);
            return (
              <label key={f.key} className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleFeature(f.key)}
                  className="rounded"
                />
                <span className="text-xs" style={{ color: "var(--foreground)" }}>{f.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded text-sm transition-colors"
          style={{ color: "var(--text-muted)" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-50"
          style={{ backgroundColor: "var(--accent)", color: "#fff" }}
        >
          {saving ? "Saving…" : initial ? "Save changes" : "Create grouping"}
        </button>
      </div>
    </div>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

interface Props {
  otBooks: Book[];
  ntBooks: Book[];
  lxxBooks: Book[];
  onClose: () => void;
}

export default function BookGroupingsDialog({ otBooks, ntBooks, lxxBooks, onClose }: Props) {
  const [groupings,  setGroupings]  = useState<BookGrouping[]>([]);
  const [loading,    setLoading]    = useState(true);
  // null = list view; "new" = create form; number = edit form for that id
  const [editingId,  setEditingId]  = useState<"new" | number | null>(null);

  // Load groupings on mount
  useEffect(() => {
    fetch("/api/book-groupings")
      .then(r => r.json())
      .then((d: { groupings?: BookGrouping[] }) => setGroupings(d.groupings ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleCreate(name: string, books: string[], features: string[]) {
    const res = await fetch("/api/book-groupings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, books, features }),
    });
    const data = await res.json();
    setGroupings(prev => [...prev, data.grouping]);
    setEditingId(null);
  }

  async function handleUpdate(id: number, name: string, books: string[], features: string[]) {
    const res = await fetch(`/api/book-groupings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, books, features }),
    });
    const data = await res.json();
    setGroupings(prev => prev.map(g => g.id === id ? data.grouping : g));
    setEditingId(null);
  }

  async function handleDelete(id: number) {
    await fetch(`/api/book-groupings/${id}`, { method: "DELETE" });
    setGroupings(prev => prev.filter(g => g.id !== id));
  }

  const editingGrouping = typeof editingId === "number"
    ? (groupings.find(g => g.id === editingId) ?? null)
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-xl rounded-lg shadow-xl border flex flex-col"
        style={{
          backgroundColor: "var(--background)",
          borderColor: "var(--border)",
          maxHeight: "90vh",
        }}
      >
        {/* Header */}
        <div
          className="shrink-0 flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
            {editingId === "new" ? "New Book Grouping"
             : editingGrouping   ? `Edit — ${editingGrouping.name}`
             : "Book Groupings"}
          </h2>
          <button
            type="button"
            onClick={editingId !== null ? () => setEditingId(null) : onClose}
            className="text-xl leading-none opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: "var(--foreground)" }}
            aria-label={editingId !== null ? "Back to list" : "Close"}
          >
            {editingId !== null ? "←" : "×"}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
          {editingId !== null ? (
            <GroupingEditor
              otBooks={otBooks}
              ntBooks={ntBooks}
              lxxBooks={lxxBooks}
              initial={editingGrouping}
              onSave={(name, books, features) =>
                editingId === "new"
                  ? handleCreate(name, books, features)
                  : handleUpdate(editingId, name, books, features)
              }
              onCancel={() => setEditingId(null)}
            />
          ) : loading ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</p>
          ) : groupings.length === 0 ? (
            <div className="text-center py-8" style={{ color: "var(--text-muted)" }}>
              <p className="text-sm mb-4">No book groupings defined yet.</p>
              <button
                type="button"
                onClick={() => setEditingId("new")}
                className="px-4 py-2 rounded text-sm font-medium transition-colors"
                style={{ backgroundColor: "var(--accent)", color: "#fff" }}
              >
                + Create first grouping
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {groupings.map(g => {
                const books    = parseJson<string[]>(g.books, []);
                const features = parseJson<string[]>(g.features, []);
                return (
                  <div
                    key={g.id}
                    className="rounded-lg border px-4 py-3 flex items-start gap-3"
                    style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                        {g.name}
                      </p>
                      <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
                        {books.length === 0
                          ? "No books selected"
                          : books.map(c => OSIS_BOOK_NAMES[c] ?? c).join(", ")}
                      </p>
                      {features.length > 0 && (
                        <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                          Features: {features.map(k => GROUPING_FEATURES.find(f => f.key === k)?.label ?? k).join(", ")}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditingId(g.id)}
                        className="text-xs px-2 py-1 rounded transition-colors hover:opacity-80"
                        style={{ color: "var(--text-muted)" }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(g.id)}
                        className="text-xs px-2 py-1 rounded transition-colors hover:text-red-500"
                        style={{ color: "var(--text-muted)" }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setEditingId("new")}
                  className="text-sm font-medium transition-colors hover:opacity-80"
                  style={{ color: "var(--accent)" }}
                >
                  + New grouping
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
