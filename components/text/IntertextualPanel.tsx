"use client";

import { useState, useEffect, useCallback } from "react";
import { LINK_TYPES } from "@/lib/utils/annotations";
import { OSIS_REF_BOOK_NAMES } from "@/lib/utils/osis";
import type { IntertextualLink } from "@/lib/db/schema";

interface Props {
  book: string;
  chapter: number;
  textSource: string;
  onClose: () => void;
}

// ── Custom link types (localStorage) ──────────────────────────────────────

const STORAGE_KEY = "structura:custom-link-types";

interface CustomLinkType {
  value: string;
  label: string;
  color: string;
}

const CUSTOM_TYPE_COLORS = [
  "#e11d48", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#0ea5e9", "#6366f1", "#a855f7", "#ec4899", "#78716c",
];

function loadCustomTypes(): CustomLinkType[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveCustomTypes(types: CustomLinkType[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(types));
}

function useCustomLinkTypes() {
  const [custom, setCustom] = useState<CustomLinkType[]>([]);

  useEffect(() => { setCustom(loadCustomTypes()); }, []);

  const add = useCallback((type: CustomLinkType) => {
    setCustom((prev) => {
      const next = [...prev, type];
      saveCustomTypes(next);
      return next;
    });
  }, []);

  const remove = useCallback((value: string) => {
    setCustom((prev) => {
      const next = prev.filter((t) => t.value !== value);
      saveCustomTypes(next);
      return next;
    });
  }, []);

  return { custom, add, remove };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function verseRange(chapter: number, verse: number, endVerse?: number | null): string {
  return endVerse && endVerse !== verse ? `${chapter}:${verse}–${endVerse}` : `${chapter}:${verse}`;
}

function bookLabel(osisBook: string): string {
  return OSIS_REF_BOOK_NAMES[osisBook] ?? osisBook;
}

function linkLabel(link: IntertextualLink, currentBook: string, currentChapter: number): string {
  const isSource = link.sourceBook === currentBook && link.sourceChapter === currentChapter;
  if (isSource) {
    return `→ ${bookLabel(link.targetBook)} ${verseRange(link.targetChapter, link.targetVerse, link.targetEndVerse)}`;
  }
  return `← ${bookLabel(link.sourceBook)} ${verseRange(link.sourceChapter, link.sourceVerse, link.sourceEndVerse)}`;
}

function resolveLinkType(value: string, custom: CustomLinkType[]): { label: string; color: string } {
  const builtin = LINK_TYPES.find((t) => t.value === value);
  if (builtin) return builtin;
  const c = custom.find((t) => t.value === value);
  if (c) return c;
  return { label: value, color: "#6b7280" };
}

const STRENGTH_LABELS: Record<number, string> = {
  1: "Unlikely",
  2: "Speculative",
  3: "Possible",
  4: "Probable",
  5: "Wide consensus",
};

function StrengthStars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <span className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange?.(n)}
          title={STRENGTH_LABELS[n]}
          className={onChange ? "cursor-pointer" : "cursor-default"}
          style={{ color: n <= value ? "#f59e0b" : "var(--text-muted)", fontSize: 13, lineHeight: 1 }}
          aria-label={STRENGTH_LABELS[n]}
        >
          ★
        </button>
      ))}
    </span>
  );
}

// ── Ref parser ─────────────────────────────────────────────────────────────

function parseRef(raw: string): { book: string; chapter: number; verse: number; endVerse?: number } | null {
  const trimmed = raw.trim();
  const books = Object.entries(OSIS_REF_BOOK_NAMES);
  for (const [osis, name] of books) {
    if (!trimmed.toLowerCase().startsWith(name.toLowerCase())) continue;
    const rest = trimmed.slice(name.length).trim();
    const m = rest.match(/^(\d+):(\d+)(?:[–\-](\d+))?$/);
    if (!m) continue;
    return {
      book: osis,
      chapter: parseInt(m[1]),
      verse: parseInt(m[2]),
      endVerse: m[3] ? parseInt(m[3]) : undefined,
    };
  }
  return null;
}

// ── Custom type creator (inline in form) ───────────────────────────────────

function CustomTypeCreator({
  custom,
  onAdd,
  onCancel,
}: {
  custom: CustomLinkType[];
  onAdd: (type: CustomLinkType) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(CUSTOM_TYPE_COLORS[0]);
  const [err, setErr] = useState("");

  function slugify(s: string) {
    return s.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  }

  function handleAdd() {
    const trimmed = label.trim();
    if (!trimmed) { setErr("Enter a name."); return; }
    const value = slugify(trimmed);
    if (!value) { setErr("Name must contain letters or numbers."); return; }
    const taken = [...LINK_TYPES, ...custom].some((t) => t.value === value);
    if (taken) { setErr("A type with that name already exists."); return; }
    onAdd({ value, label: trimmed, color });
  }

  return (
    <div className="mt-1 rounded border border-[var(--border)] p-2 flex flex-col gap-2 bg-[var(--input-bg,white)] dark:bg-stone-800">
      <input
        autoFocus
        placeholder="Type name (e.g. Verbal echo)"
        value={label}
        onChange={(e) => { setLabel(e.target.value); setErr(""); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } if (e.key === "Escape") onCancel(); }}
        className="w-full rounded border px-2 py-1 text-xs bg-[var(--input-bg,white)] dark:bg-stone-800 border-[var(--border)] text-[var(--foreground)]"
      />
      <div className="flex flex-wrap gap-1">
        {CUSTOM_TYPE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            title={c}
            style={{ backgroundColor: c, width: 18, height: 18, borderRadius: 3, outline: color === c ? `2px solid ${c}` : "none", outlineOffset: 2 }}
          />
        ))}
      </div>
      {err && <p className="text-red-500 text-xs">{err}</p>}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={handleAdd}
          className="flex-1 py-1 rounded text-xs font-medium bg-amber-500 hover:bg-amber-600 text-white"
        >
          Add type
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-2 py-1 rounded text-xs border border-[var(--border)] text-[var(--foreground)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Add/Edit Form ──────────────────────────────────────────────────────────

interface FormState {
  sourceRef: string;
  targetRef: string;
  linkType: string;
  strength: number;
  notes: string;
  direction: string;
}

function LinkForm({
  book, chapter, textSource,
  editLink,
  custom, onAddCustom, onRemoveCustom,
  onSave, onCancel,
}: {
  book: string; chapter: number; textSource: string;
  editLink?: IntertextualLink;
  custom: CustomLinkType[];
  onAddCustom: (type: CustomLinkType) => void;
  onRemoveCustom: (value: string) => void;
  onSave: () => void; onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => {
    if (!editLink) {
      return {
        sourceRef: `${bookLabel(book)} ${chapter}:1`,
        targetRef: "",
        linkType: "allusion",
        strength: 3,
        notes: "",
        direction: "source_to_target",
      };
    }
    const srcStr = `${bookLabel(editLink.sourceBook)} ${editLink.sourceChapter}:${editLink.sourceVerse}${editLink.sourceEndVerse ? `-${editLink.sourceEndVerse}` : ""}`;
    const tgtStr = `${bookLabel(editLink.targetBook)} ${editLink.targetChapter}:${editLink.targetVerse}${editLink.targetEndVerse ? `-${editLink.targetEndVerse}` : ""}`;
    return {
      sourceRef: srcStr,
      targetRef: tgtStr,
      linkType: editLink.linkType,
      strength: editLink.strength,
      notes: editLink.notes ?? "",
      direction: editLink.direction,
    };
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCustomCreator, setShowCustomCreator] = useState(false);
  const [showManage, setShowManage] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsedTarget = parseRef(form.targetRef);
    if (!parsedTarget) { setError('Unrecognised target reference. Try e.g. "John 3:16" or "Gen 1:1-3".'); return; }
    const parsedSource = parseRef(form.sourceRef);
    if (!parsedSource) { setError('Unrecognised source reference. Try e.g. "Gen 1:1" or "Isa 7:14-16".'); return; }
    setSaving(true);
    try {
      if (editLink) {
        await fetch("/api/intertextual-links", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editLink.id,
            sourceBook: parsedSource.book,
            sourceChapter: parsedSource.chapter,
            sourceVerse: parsedSource.verse,
            sourceEndVerse: parsedSource.endVerse ?? null,
            targetBook: parsedTarget.book,
            targetChapter: parsedTarget.chapter,
            targetVerse: parsedTarget.verse,
            targetEndVerse: parsedTarget.endVerse ?? null,
            linkType: form.linkType,
            strength: form.strength,
            notes: form.notes || null,
            direction: form.direction,
          }),
        });
      } else {
        await fetch("/api/intertextual-links", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceBook: parsedSource.book,
            sourceChapter: parsedSource.chapter,
            sourceVerse: parsedSource.verse,
            sourceEndVerse: parsedSource.endVerse ?? null,
            sourceTextSource: textSource,
            targetBook: parsedTarget.book,
            targetChapter: parsedTarget.chapter,
            targetVerse: parsedTarget.verse,
            targetEndVerse: parsedTarget.endVerse ?? null,
            targetTextSource: textSource,
            linkType: form.linkType, strength: form.strength,
            notes: form.notes || null, direction: form.direction,
          }),
        });
      }
      onSave();
    } catch {
      setError("Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const fieldClass = "w-full rounded border px-2 py-1 text-sm bg-[var(--input-bg,white)] dark:bg-stone-800 border-[var(--border)] text-[var(--foreground)]";
  const allTypes = [...LINK_TYPES, ...custom];
  const currentTypeKnown = allTypes.some((t) => t.value === form.linkType);

  return (
    <form onSubmit={handleSubmit} className="p-3 border-b border-[var(--border)] flex flex-col gap-2 text-sm">
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-0.5">Source reference</label>
        <input
          className={fieldClass}
          placeholder="e.g. Gen 1:1 or Isa 7:14-16"
          value={form.sourceRef}
          onChange={(e) => setForm((f) => ({ ...f, sourceRef: e.target.value }))}
          autoFocus
        />
      </div>
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-0.5">Target reference</label>
        <input
          className={fieldClass}
          placeholder="e.g. John 1:1 or Isa 7:14–16"
          value={form.targetRef}
          onChange={(e) => setForm((f) => ({ ...f, targetRef: e.target.value }))}
        />
      </div>
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-0.5">Link type</label>
        <select
          className={fieldClass}
          value={form.linkType}
          onChange={(e) => {
            if (e.target.value === "__new__") {
              setShowCustomCreator(true);
            } else {
              setForm((f) => ({ ...f, linkType: e.target.value }));
              setShowCustomCreator(false);
            }
          }}
        >
          <optgroup label="Built-in">
            {LINK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </optgroup>
          {custom.length > 0 && (
            <optgroup label="Custom">
              {custom.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </optgroup>
          )}
          {!currentTypeKnown && (
            <option value={form.linkType}>{form.linkType}</option>
          )}
          <option value="__new__">＋ Create new type…</option>
        </select>
        {showCustomCreator && (
          <CustomTypeCreator
            custom={custom}
            onAdd={(type) => {
              onAddCustom(type);
              setForm((f) => ({ ...f, linkType: type.value }));
              setShowCustomCreator(false);
            }}
            onCancel={() => setShowCustomCreator(false)}
          />
        )}
        {!showCustomCreator && custom.length > 0 && (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setShowManage((v) => !v)}
              className="text-xs text-[var(--text-muted)] hover:underline"
            >
              {showManage ? "Hide custom types" : "Manage custom types…"}
            </button>
            {showManage && (
              <div className="mt-1 rounded border border-[var(--border)] divide-y divide-[var(--border)] bg-[var(--input-bg,white)] dark:bg-stone-800">
                {custom.map((t) => (
                  <div key={t.value} className="flex items-center gap-2 px-2 py-1">
                    <span
                      className="w-3 h-3 rounded-sm shrink-0"
                      style={{ backgroundColor: t.color }}
                    />
                    <span className="flex-1 text-xs text-[var(--foreground)]">{t.label}</span>
                    <button
                      type="button"
                      title="Delete custom type"
                      onClick={() => {
                        onRemoveCustom(t.value);
                        if (form.linkType === t.value) setForm((f) => ({ ...f, linkType: "allusion" }));
                      }}
                      className="text-xs text-[var(--text-muted)] hover:text-red-500"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-0.5">Confidence</label>
        <StrengthStars value={form.strength} onChange={(v) => setForm((f) => ({ ...f, strength: v }))} />
      </div>
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-0.5">Direction</label>
        <select
          className={fieldClass}
          value={form.direction}
          onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))}
        >
          <option value="source_to_target">Source → Target</option>
          <option value="bidirectional">Bidirectional</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-0.5">Notes</label>
        <textarea
          className={fieldClass}
          rows={3}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          placeholder="Scholarly argumentation, key shared terms…"
        />
      </div>
      {error && <p className="text-red-500 text-xs">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 py-1.5 rounded text-sm font-medium bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-60"
        >
          {saving ? "Saving…" : editLink ? "Save changes" : "Add link"}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded text-sm border border-[var(--border)] text-[var(--foreground)]">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Link row ───────────────────────────────────────────────────────────────

function LinkRow({
  link, book, chapter,
  custom,
  onEdit, onDelete,
}: {
  link: IntertextualLink; book: string; chapter: number;
  custom: CustomLinkType[];
  onEdit: (link: IntertextualLink) => void;
  onDelete: (id: number) => void;
}) {
  const { label: typeLabel, color } = resolveLinkType(link.linkType, custom);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="px-3 py-2 border-b border-[var(--border)] last:border-b-0 text-sm">
      <div className="flex items-start gap-2">
        <span
          className="mt-0.5 shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded"
          style={{ backgroundColor: color + "25", color }}
        >
          {typeLabel}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[var(--foreground)] truncate">
            {linkLabel(link, book, chapter)}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <StrengthStars value={link.strength} />
            {link.direction === "bidirectional" && (
              <span className="text-xs text-[var(--text-muted)]">↔</span>
            )}
          </div>
          {link.notes && (
            <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2">{link.notes}</p>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => onEdit(link)}
            className="px-1.5 py-0.5 rounded text-xs text-[var(--text-muted)] hover:bg-stone-100 dark:hover:bg-stone-800"
            title="Edit"
          >
            ✎
          </button>
          {confirming ? (
            <button
              onClick={() => { onDelete(link.id); setConfirming(false); }}
              className="px-1.5 py-0.5 rounded text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
            >
              ✕ Sure?
            </button>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="px-1.5 py-0.5 rounded text-xs text-[var(--text-muted)] hover:bg-stone-100 dark:hover:bg-stone-800"
              title="Delete"
            >
              🗑
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────

export default function IntertextualPanel({ book, chapter, textSource, onClose }: Props) {
  const [links, setLinks] = useState<IntertextualLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editLink, setEditLink] = useState<IntertextualLink | null>(null);
  const { custom, add: addCustom, remove: removeCustom } = useCustomLinkTypes();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/intertextual-links?book=${encodeURIComponent(book)}&chapter=${chapter}`);
      const data = await res.json();
      setLinks(data.links ?? []);
    } finally {
      setLoading(false);
    }
  }, [book, chapter]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id: number) {
    await fetch("/api/intertextual-links", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load();
  }

  const graphHref = `/${encodeURIComponent(book)}/${textSource}/intertextual-graph`;

  return (
    <div className="flex flex-col h-full min-h-0" style={{ backgroundColor: "var(--panel-bg, var(--background))" }}>
      {/* Header */}
      <div
        className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-[var(--border)]"
        style={{ backgroundColor: "var(--nav-bg)" }}
      >
        <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
          Intertextual Links
        </span>
        <div className="flex items-center gap-1">
          <a
            href={graphHref}
            title="Open graph view"
            className="px-2 py-1 rounded text-xs text-[var(--text-muted)] hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            ⬡ Graph
          </a>
          <button
            onClick={() => { setShowForm(true); setEditLink(null); }}
            className="px-2 py-1 rounded text-xs bg-amber-500 hover:bg-amber-600 text-white"
          >
            + Add
          </button>
          <button
            onClick={onClose}
            className="px-2 py-1 rounded text-xs text-[var(--text-muted)] hover:bg-stone-100 dark:hover:bg-stone-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Add / Edit form */}
      {(showForm || editLink) && (
        <LinkForm
          book={book}
          chapter={chapter}
          textSource={textSource}
          editLink={editLink ?? undefined}
          custom={custom}
          onAddCustom={addCustom}
          onRemoveCustom={removeCustom}
          onSave={() => { setShowForm(false); setEditLink(null); load(); }}
          onCancel={() => { setShowForm(false); setEditLink(null); }}
        />
      )}

      {/* Link list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="p-4 text-sm text-[var(--text-muted)]">Loading…</div>
        ) : links.length === 0 ? (
          <div className="p-4 text-sm text-[var(--text-muted)]">
            No intertextual links for {bookLabel(book)} {chapter}.
            <br />
            <button
              onClick={() => setShowForm(true)}
              className="mt-2 text-amber-500 hover:underline"
            >
              + Add the first link
            </button>
          </div>
        ) : (
          links.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              book={book}
              chapter={chapter}
              custom={custom}
              onEdit={(l) => { setEditLink(l); setShowForm(false); }}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}
