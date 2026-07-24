"use client";

import { useEffect, useState } from "react";
import type { WordTag, BookGrouping } from "@/lib/db/schema";
import { ColorSwatches, CorpusSelector, type CorpusAssignment } from "@/components/controls/WordTagPanel";

/**
 * The same name/color/corpus editor the chapter reading view's Tags sidebar
 * opens on double-click — surfaced here as a standalone modal so it's also
 * reachable from Manage Lists, which has no live chapter to host it inline.
 * Lemma editing is intentionally left out: adding a lemma re-scans and
 * re-links every matching word in a specific text source/chapter, which only
 * make sense from a page that already has a chapter loaded.
 */
export default function TagEditModal({
  tagName,
  onClose,
  onSaved,
}: {
  tagName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tags, setTags] = useState<WordTag[] | null>(null);
  const [bookGroupings, setBookGroupings] = useState<BookGrouping[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/word-tags/by-name?name=${encodeURIComponent(tagName)}`).then((r) => r.json()),
      fetch("/api/book-groupings").then((r) => r.json()),
    ]).then(([tagsRes, groupingsRes]) => {
      if (cancelled) return;
      setTags(tagsRes.tags ?? []);
      setBookGroupings(groupingsRes.groupings ?? []);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tagName]);

  async function handleCreateGrouping(name: string, books: string[]): Promise<BookGrouping> {
    const res = await fetch("/api/book-groupings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, books, features: ["wordTags"] }),
    });
    const data = await res.json();
    setBookGroupings((prev) => [...prev, data.grouping]);
    return data.grouping;
  }

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-lg border shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-sm font-semibold truncate" style={{ color: "var(--foreground)" }}>
            Edit &ldquo;{tagName}&rdquo;
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 ml-3 text-lg leading-none opacity-60 hover:opacity-100 transition-opacity"
            style={{ color: "var(--foreground)" }}
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-3">
          {loading && <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</p>}
          {!loading && tags?.length === 0 && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>Tag not found.</p>
          )}
          {!loading && (tags?.length ?? 0) > 1 && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              This name is used by {tags!.length} separate tags across different books — edit each one below.
            </p>
          )}
          {!loading && tags?.map((tag) => (
            <TagRowEditor
              key={tag.id}
              tag={tag}
              bookGroupings={bookGroupings}
              onCreateGrouping={handleCreateGrouping}
              onSaved={onSaved}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TagRowEditor({
  tag,
  bookGroupings,
  onCreateGrouping,
  onSaved,
}: {
  tag: WordTag;
  bookGroupings: BookGrouping[];
  onCreateGrouping: (name: string, books: string[]) => Promise<BookGrouping>;
  onSaved: () => void;
}) {
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const initialCorpus: CorpusAssignment = {
    mode: (tag.corpusType as CorpusAssignment["mode"]) ?? "book",
    groupingId: tag.corpusGroupingId ?? null,
    chapter: tag.corpusChapter ?? null,
    passageId: tag.corpusPassageId ?? null,
  };
  const [corpus, setCorpus] = useState<CorpusAssignment>(initialCorpus);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // Tracks the last-saved values so "dirty"/"Saved" reflect this save, not
  // the modal's original snapshot (which never changes after it's fetched).
  const [savedSnapshot, setSavedSnapshot] = useState({ name: tag.name, color: tag.color, corpus: initialCorpus });

  const dirty = name !== savedSnapshot.name || color !== savedSnapshot.color ||
    corpus.mode !== savedSnapshot.corpus.mode ||
    corpus.groupingId !== savedSnapshot.corpus.groupingId ||
    corpus.chapter !== savedSnapshot.corpus.chapter ||
    corpus.passageId !== savedSnapshot.corpus.passageId;

  async function handleSave() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await fetch(`/api/word-tags/${tag.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), color,
          corpusType: corpus.mode,
          corpusGroupingId: corpus.groupingId,
          corpusChapter: corpus.chapter,
          corpusPassageId: corpus.passageId,
        }),
      });
      setSavedSnapshot({ name: name.trim(), color, corpus });
      setJustSaved(true);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          {tag.book === "*" ? "Corpus-wide (saved search)" : tag.book}
        </span>
        <span className="text-[10px] uppercase tracking-wide opacity-60" style={{ color }}>{tag.type}</span>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setJustSaved(false); }}
          className="flex-1 min-w-0 text-sm px-2 py-1 rounded border bg-transparent"
          style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
        />
        <ColorSwatches selected={color} onPick={(c) => { setColor(c); setJustSaved(false); }} />
      </div>

      <CorpusSelector
        currentBook={tag.book === "*" ? "—" : tag.book}
        bookGroupings={bookGroupings}
        corpusMode={corpus.mode}
        corpusGroupingId={corpus.groupingId}
        corpusChapter={corpus.chapter}
        corpusPassageId={corpus.passageId}
        onSelect={(assignment) => { setCorpus(assignment); setJustSaved(false); }}
        onCreateGrouping={async (n, b) => {
          const g = await onCreateGrouping(n, b);
          setCorpus({ mode: "grouping", groupingId: g.id, chapter: null, passageId: null });
          setJustSaved(false);
        }}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving || !name.trim()}
          className="text-xs font-semibold px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {justSaved && !dirty && (
          <span className="text-xs text-green-600 dark:text-green-400">Saved</span>
        )}
      </div>
    </div>
  );
}
