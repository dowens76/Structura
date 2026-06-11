"use client";

import { useState, useEffect, useCallback } from "react";
import { LINK_TYPES, getLinkTypeColor } from "@/lib/utils/annotations";
import { OSIS_REF_BOOK_NAMES } from "@/lib/utils/osis";
import type { IntertextualLink } from "@/lib/db/schema";

interface Props {
  book: string;
  chapter: number;
  textSource: string;
  onClose: () => void;
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

function StrengthStars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <span className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange?.(n)}
          className={onChange ? "cursor-pointer" : "cursor-default"}
          style={{ color: n <= value ? "#f59e0b" : "var(--text-muted)", fontSize: 13, lineHeight: 1 }}
          aria-label={`Strength ${n}`}
        >
          ★
        </button>
      ))}
    </span>
  );
}

// ── Ref parser ─────────────────────────────────────────────────────────────
// Simple parser: "Book Chapter:Verse[-EndVerse]" or "Book Chapter:Verse-Chapter:EndVerse"
function parseRef(raw: string): { book: string; chapter: number; verse: number; endVerse?: number } | null {
  const trimmed = raw.trim();
  // Try to match known book names
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
  onSave, onCancel,
}: {
  book: string; chapter: number; textSource: string;
  editLink?: IntertextualLink;
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
          onChange={(e) => setForm((f) => ({ ...f, linkType: e.target.value }))}
        >
          {LINK_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
          {!LINK_TYPES.find((t) => t.value === form.linkType) && (
            <option value={form.linkType}>{form.linkType}</option>
          )}
        </select>
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
  onEdit, onDelete,
}: {
  link: IntertextualLink; book: string; chapter: number;
  onEdit: (link: IntertextualLink) => void;
  onDelete: (id: number) => void;
}) {
  const color = getLinkTypeColor(link.linkType);
  const typeLabel = LINK_TYPES.find((t) => t.value === link.linkType)?.label ?? link.linkType;
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
              onEdit={(l) => { setEditLink(l); setShowForm(false); }}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}
