"use client";

import { useState, useRef, useEffect } from "react";
import type { WordTag, BookGrouping } from "@/lib/db/schema";
import type { LemmaSuggestion } from "@/app/api/search/lemma-suggest/route";
import { RULE_PALETTE } from "@/lib/morphology/colorRules";
import { OSIS_BOOKS_OT, OSIS_BOOKS_NT, OSIS_BOOKS_LXX, OSIS_BOOK_NAMES } from "@/lib/utils/osis";

const TAG_PALETTE: string[] = [
  ...RULE_PALETTE,
  "#b91c1c", "#c2410c", "#a16207", "#166534",
  "#0f766e", "#1d4ed8", "#6d28d9", "#be185d",
];

type TagType = "concept" | "word" | "cluster";
type CorpusMode = "book" | "grouping" | "new";

interface WordTagPanelProps {
  tags: WordTag[];
  activeTagId: number | null;
  highlightedTagIds: Set<number>;
  pendingWordTag: boolean;
  currentBook: string;
  bookGroupings: BookGrouping[];
  clusterPickingActive: boolean;
  onSelectTag: (id: number) => void;
  onCreateConceptTag: (name: string, color: string, corpusGroupingId: number | null) => void;
  onCreatePendingWordTag: (color: string, corpusGroupingId: number | null) => void;
  onCreateClusterTag: (name: string, lemmas: string[], color: string, corpusGroupingId: number | null, corpusBooks: string[]) => void;
  onDeleteTag: (id: number) => void;
  onUpdateTag: (id: number, name: string, color: string, corpusGroupingId?: number | null, lemmas?: string[] | null) => void;
  onReorder: (ids: number[]) => void;
  onToggleHighlight: (id: number) => void;
  onCreateGrouping: (name: string, books: string[], features: string[]) => Promise<BookGrouping>;
  onRequestWordClick: (onPicked: (lemma: string) => void) => void;
  onCancelWordClick: () => void;
}

// ── Inline Book Grouping creator ─────────────────────────────────────────────

interface NewGroupingFormProps {
  currentBook: string;
  onSave: (name: string, books: string[]) => Promise<void>;
  onCancel: () => void;
}

function NewGroupingForm({ currentBook, onSave, onCancel }: NewGroupingFormProps) {
  const [name, setName] = useState("");
  const [selectedBooks, setSelectedBooks] = useState<Set<string>>(new Set([currentBook]));
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  function toggleBook(code: string) {
    setSelectedBooks((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  async function handleSave() {
    if (!name.trim() || selectedBooks.size === 0) return;
    setSaving(true);
    try { await onSave(name.trim(), [...selectedBooks]); }
    finally { setSaving(false); }
  }

  function BookRow({ codes, label }: { codes: string[]; label: string }) {
    const all = codes.every((c) => selectedBooks.has(c));
    return (
      <div className="mb-2">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{label}</span>
          <button type="button" onClick={() => {
            const next = new Set(selectedBooks);
            all ? codes.forEach((c) => next.delete(c)) : codes.forEach((c) => next.add(c));
            setSelectedBooks(next);
          }} className="text-[9px] px-1 py-0.5 rounded border transition-colors" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
            {all ? "None" : "All"}
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {codes.map((c) => {
            const on = selectedBooks.has(c);
            return (
              <button key={c} type="button" onClick={() => toggleBook(c)}
                className="text-[9px] px-1.5 py-0.5 rounded border transition-colors"
                style={{
                  borderColor: on ? "var(--accent)" : "var(--border)",
                  backgroundColor: on ? "rgba(200,155,60,0.12)" : "transparent",
                  color: on ? "var(--accent)" : "var(--foreground)",
                  fontWeight: on ? 600 : 400,
                }} title={OSIS_BOOK_NAMES[c] ?? c}
              >{c}</button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute top-full left-0 mt-1 z-50 rounded-lg border shadow-xl p-3 w-80"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>New Book Grouping</span>
        <button type="button" onClick={onCancel} className="text-xs opacity-50 hover:opacity-100 leading-none" style={{ color: "var(--foreground)" }}>×</button>
      </div>
      <input ref={nameRef} type="text" value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onCancel(); }}
        placeholder="Grouping name" className="w-full px-2 py-1 text-xs rounded border mb-2"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--foreground)" }} />
      <div className="max-h-44 overflow-y-auto border rounded p-2 mb-2" style={{ borderColor: "var(--border)" }}>
        <BookRow codes={OSIS_BOOKS_OT} label="OT" />
        <BookRow codes={OSIS_BOOKS_NT} label="NT" />
        <BookRow codes={OSIS_BOOKS_LXX.filter((c) => !OSIS_BOOKS_OT.includes(c) && !OSIS_BOOKS_NT.includes(c))} label="LXX" />
      </div>
      <p className="text-[10px] mb-2" style={{ color: "var(--text-muted)" }}>{selectedBooks.size} book{selectedBooks.size !== 1 ? "s" : ""} selected</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-xs px-2 py-0.5 rounded" style={{ color: "var(--text-muted)" }}>Cancel</button>
        <button type="button" onClick={handleSave} disabled={saving || !name.trim() || selectedBooks.size === 0}
          className="text-xs font-semibold px-2.5 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? "Creating…" : "Create"}
        </button>
      </div>
    </div>
  );
}

// ── Corpus selector ───────────────────────────────────────────────────────────

interface CorpusSelectorProps {
  currentBook: string;
  bookGroupings: BookGrouping[];
  corpusMode: CorpusMode;
  corpusGroupingId: number | null;
  onSelect: (mode: CorpusMode, groupingId: number | null) => void;
  onCreateGrouping: (name: string, books: string[]) => Promise<void>;
}

function CorpusSelector({ currentBook, bookGroupings, corpusMode, corpusGroupingId, onSelect, onCreateGrouping }: CorpusSelectorProps) {
  const [open, setOpen] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const selectedGrouping = corpusGroupingId != null ? bookGroupings.find((g) => g.id === corpusGroupingId) : null;
  const label = corpusMode === "book" ? currentBook : (selectedGrouping?.name ?? "Grouping");

  return (
    <div className="relative flex items-center gap-1 shrink-0" ref={ref}>
      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Corpus:</span>
      <button type="button" onClick={() => { setOpen((v) => !v); setShowNewForm(false); }}
        className="text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-0.5 transition-colors hover:border-blue-400"
        style={{ borderColor: "var(--border)", color: "var(--foreground)" }}>
        {label}
        <span style={{ color: "var(--text-muted)" }}>▾</span>
      </button>

      {open && !showNewForm && (
        <div className="absolute top-full left-0 mt-1 z-50 rounded-lg border shadow-lg py-1 min-w-[160px]"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
          <button type="button" onClick={() => { onSelect("book", null); setOpen(false); }}
            className="w-full text-left text-xs px-3 py-1.5 transition-colors hover:bg-stone-100 dark:hover:bg-stone-800 flex items-center gap-2"
            style={{ color: "var(--foreground)" }}>
            {corpusMode === "book" && <span className="text-blue-500 text-xs">✓</span>}
            {corpusMode !== "book" && <span className="w-3" />}
            Current book ({currentBook})
          </button>

          {bookGroupings.length > 0 && (
            <>
              <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
              {bookGroupings.map((g) => (
                <button key={g.id} type="button"
                  onClick={() => { onSelect("grouping", g.id); setOpen(false); }}
                  className="w-full text-left text-xs px-3 py-1.5 transition-colors hover:bg-stone-100 dark:hover:bg-stone-800 flex items-center gap-2"
                  style={{ color: "var(--foreground)" }}>
                  {corpusMode === "grouping" && corpusGroupingId === g.id ? <span className="text-blue-500 text-xs">✓</span> : <span className="w-3" />}
                  {g.name}
                </button>
              ))}
            </>
          )}

          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
          <button type="button" onClick={() => { setShowNewForm(true); setOpen(false); }}
            className="w-full text-left text-xs px-3 py-1.5 transition-colors hover:bg-stone-100 dark:hover:bg-stone-800"
            style={{ color: "var(--accent)" }}>
            + New grouping…
          </button>
        </div>
      )}

      {showNewForm && (
        <NewGroupingForm currentBook={currentBook}
          onSave={async (name, booksArr) => { await onCreateGrouping(name, booksArr); setShowNewForm(false); }}
          onCancel={() => setShowNewForm(false)} />
      )}
    </div>
  );
}

// ── Lemma Picker Input ────────────────────────────────────────────────────────

interface LemmaPickerInputProps {
  color: string;
  lemmas: string[];
  pickingActive: boolean;
  onAdd: (lemma: string) => void;
  onRemove: (lemma: string) => void;
  onRequestWordClick: (onPicked: (lemma: string) => void) => void;
  onCancelWordClick: () => void;
}

function LemmaPickerInput({ color, lemmas, pickingActive, onAdd, onRemove, onRequestWordClick, onCancelWordClick }: LemmaPickerInputProps) {
  const [inputVal, setInputVal] = useState("");
  const [suggestions, setSuggestions] = useState<LemmaSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [activeSuggIdx, setActiveSuggIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function handleInput(val: string) {
    setInputVal(val);
    setActiveSuggIdx(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) { setSuggestions([]); setShowSuggestions(false); return; }
    debounceRef.current = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const res = await fetch(`/api/search/lemma-suggest?q=${encodeURIComponent(val.trim())}&limit=10`);
        const data = await res.json();
        setSuggestions(data.suggestions ?? []);
        setShowSuggestions((data.suggestions ?? []).length > 0);
      } catch { setSuggestions([]); }
      finally { setLoadingSuggestions(false); }
    }, 280);
  }

  function canonicalId(s: LemmaSuggestion): string {
    return s.language === "hebrew"
      ? (s.strongNumber ?? s.surfaceNorm)
      : (s.lemma ?? s.surfaceNorm);
  }

  function displayLabel(s: LemmaSuggestion): string {
    return s.language === "hebrew"
      ? (s.surfaceText ?? s.surfaceNorm)
      : (s.lemma ?? s.surfaceNorm);
  }

  function pickSuggestion(s: LemmaSuggestion) {
    const id = canonicalId(s);
    if (id) onAdd(id);
    setInputVal("");
    setSuggestions([]);
    setShowSuggestions(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveSuggIdx((i) => Math.min(i + 1, suggestions.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveSuggIdx((i) => Math.max(i - 1, -1)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      if (activeSuggIdx >= 0 && suggestions[activeSuggIdx]) {
        pickSuggestion(suggestions[activeSuggIdx]);
      } else if (inputVal.trim()) {
        onAdd(inputVal.trim());
        setInputVal("");
        setSuggestions([]);
        setShowSuggestions(false);
      }
      return;
    }
    if (e.key === "Escape") { setShowSuggestions(false); setInputVal(""); }
  }

  function handlePickFromText() {
    if (pickingActive) { onCancelWordClick(); return; }
    onRequestWordClick((lemma) => { onAdd(lemma); });
  }

  return (
    <div className="space-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Lemmas</span>
      {lemmas.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {lemmas.map((l) => (
            <span key={l} className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border"
              style={{ borderColor: color, color: "var(--foreground)" }}>
              {l}
              <button type="button" onClick={() => onRemove(l)}
                className="ml-0.5 opacity-50 hover:opacity-100 leading-none">×</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1 items-center" ref={containerRef}>
        <div className="relative flex-1">
          <input
            type="text"
            value={inputVal}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            placeholder="Type lemma or H/G1234…"
            className="w-full text-[10px] px-1.5 py-0.5 rounded border bg-transparent"
            style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 mt-0.5 z-50 rounded-lg border shadow-lg py-1 min-w-[220px] max-h-48 overflow-y-auto"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
              {suggestions.map((s, idx) => {
                const id = canonicalId(s);
                const label = displayLabel(s);
                const alreadyAdded = lemmas.includes(id);
                return (
                  <button key={`${id}-${idx}`} type="button"
                    onMouseDown={(e) => { e.preventDefault(); if (!alreadyAdded) pickSuggestion(s); }}
                    className="w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-40"
                    style={{ backgroundColor: idx === activeSuggIdx ? "var(--surface-muted, var(--surface))" : undefined, color: "var(--foreground)" }}
                    disabled={alreadyAdded}>
                    <span className="text-[11px] shrink-0" style={{ direction: s.language === "hebrew" ? "rtl" : "ltr" }}>{label}</span>
                    {s.strongNumber && (
                      <span className="text-[9px] font-mono opacity-50 shrink-0">{s.strongNumber}</span>
                    )}
                    {s.gloss && (
                      <span className="text-[9px] truncate opacity-70 flex-1">{s.gloss}</span>
                    )}
                    {alreadyAdded && <span className="text-[9px] opacity-40 ml-auto">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
          {loadingSuggestions && (
            <span className="absolute right-1 top-0.5 text-[9px] opacity-40" style={{ color: "var(--text-muted)" }}>…</span>
          )}
        </div>
        <button
          type="button"
          onClick={handlePickFromText}
          title={pickingActive ? "Cancel picking" : "Click a word in the text to add its lemma"}
          className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors shrink-0 ${pickingActive ? "border-amber-400 text-amber-600 dark:text-amber-400" : "border-transparent hover:border-blue-400 hover:text-blue-500"}`}
          style={{ color: pickingActive ? undefined : "var(--text-muted)" }}>
          {pickingActive ? "↑ Cancel" : "↑ Text"}
        </button>
      </div>
      {pickingActive && (
        <p className="text-[9px] italic animate-pulse" style={{ color: "var(--accent)" }}>
          Click any source word to add its lemma…
        </p>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function WordTagPanel({
  tags,
  activeTagId,
  highlightedTagIds,
  pendingWordTag,
  currentBook,
  bookGroupings,
  clusterPickingActive,
  onSelectTag,
  onCreateConceptTag,
  onCreatePendingWordTag,
  onCreateClusterTag,
  onDeleteTag,
  onUpdateTag,
  onReorder,
  onToggleHighlight,
  onCreateGrouping,
  onRequestWordClick,
  onCancelWordClick,
}: WordTagPanelProps) {
  const [showNew, setShowNew] = useState(false);
  const [newType, setNewType] = useState<TagType>("concept");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(TAG_PALETTE[0]);
  const [newLemmas, setNewLemmas] = useState<string[]>([]);
  const [newCorpusMode, setNewCorpusMode] = useState<CorpusMode>("book");
  const [newCorpusGroupingId, setNewCorpusGroupingId] = useState<number | null>(null);

  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(TAG_PALETTE[0]);
  const [editCorpusMode, setEditCorpusMode] = useState<CorpusMode>("book");
  const [editCorpusGroupingId, setEditCorpusGroupingId] = useState<number | null>(null);
  const [editLemmas, setEditLemmas] = useState<string[]>([]);

  const [showReorder, setShowReorder] = useState(false);
  const [reorderList, setReorderList] = useState<WordTag[]>([]);
  const dragIdx = useRef<number | null>(null);

  function resetNew() {
    setNewName("");
    setNewColor(TAG_PALETTE[0]);
    setNewType("concept");
    setNewLemmas([]);
    setNewCorpusMode("book");
    setNewCorpusGroupingId(null);
  }

  function handleStartEdit(t: WordTag) {
    setEditingTagId(t.id);
    setEditName(t.name);
    setEditColor(t.color);
    setEditCorpusGroupingId(t.corpusGroupingId ?? null);
    setEditCorpusMode(t.corpusGroupingId != null ? "grouping" : "book");
    const parsed = t.lemmas ? (() => { try { return JSON.parse(t.lemmas) as string[]; } catch { return []; } })() : [];
    setEditLemmas(parsed);
    setConfirmDeleteId(null);
  }

  function handleSaveEdit() {
    if (!editingTagId || !editName.trim()) return;
    const corpusId = editCorpusMode === "grouping" ? editCorpusGroupingId : null;
    const lemmasToSave = editLemmas.length > 0 ? editLemmas : null;
    onUpdateTag(editingTagId, editName.trim(), editColor, corpusId, lemmasToSave);
    setEditingTagId(null);
  }

  function resolveCorpusBooks(mode: CorpusMode, groupingId: number | null): string[] {
    if (mode === "book") return [currentBook];
    if (mode === "grouping" && groupingId != null) {
      const g = bookGroupings.find((g) => g.id === groupingId);
      if (g) {
        try { return JSON.parse(g.books) as string[]; } catch { return [currentBook]; }
      }
    }
    return [currentBook];
  }

  function handleCreate() {
    const corpusId = newCorpusMode === "grouping" ? newCorpusGroupingId : null;
    const corpusBooks = resolveCorpusBooks(newCorpusMode, newCorpusGroupingId);

    if (newType === "concept") {
      if (!newName.trim()) return;
      onCreateConceptTag(newName.trim(), newColor, corpusId);
    } else if (newType === "word") {
      onCreatePendingWordTag(newColor, corpusId);
    } else {
      // cluster
      if (!newName.trim() || newLemmas.length === 0) return;
      onCreateClusterTag(newName.trim(), newLemmas, newColor, corpusId, corpusBooks);
    }
    resetNew();
    setShowNew(false);
  }

  async function handleCreateGroupingForNew(name: string, booksArr: string[]) {
    const g = await onCreateGrouping(name, booksArr, ["wordTags"]);
    setNewCorpusMode("grouping");
    setNewCorpusGroupingId(g.id);
  }

  async function handleCreateGroupingForEdit(name: string, booksArr: string[]) {
    const g = await onCreateGrouping(name, booksArr, ["wordTags"]);
    setEditCorpusMode("grouping");
    setEditCorpusGroupingId(g.id);
  }

  function openReorder() {
    setReorderList([...tags]);
    setShowReorder(true);
  }

  function handleDragStart(idx: number) { dragIdx.current = idx; }
  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    const next = [...reorderList];
    const [moved] = next.splice(dragIdx.current, 1);
    next.splice(idx, 0, moved);
    dragIdx.current = idx;
    setReorderList(next);
  }
  function handleDragEnd() { dragIdx.current = null; }
  function handleSaveReorder() { onReorder(reorderList.map((t) => t.id)); setShowReorder(false); }

  const colorSwatches = (selected: string, onPick: (c: string) => void) => (
    <div className="flex flex-wrap gap-1" style={{ maxWidth: "10rem" }}>
      {TAG_PALETTE.map((col) => (
        <button key={col} type="button" onClick={() => onPick(col)}
          className="w-4 h-4 rounded-full transition-transform hover:scale-110"
          style={{ backgroundColor: col, outline: selected === col ? `2px solid ${col}` : "none", outlineOffset: "1px" }} />
      ))}
      <input type="color" value={selected} onChange={(e) => onPick(e.target.value)}
        className="w-4 h-4 rounded-full cursor-pointer border-0 p-0 bg-transparent" title="Custom color" />
    </div>
  );

  const typeBadge = (t: WordTag) => {
    if (t.type === "word")    return "W";
    if (t.type === "cluster") return "K";
    if (t.type === "search")  return "S";
    return "C";
  };

  const corpusLabel = (t: WordTag) => {
    if (!t.corpusGroupingId) return null;
    const g = bookGroupings.find((g) => g.id === t.corpusGroupingId);
    return g ? g.name : null;
  };

  return (
    <div className="shrink-0 border-t relative"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
      <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto">

        {/* Mode label */}
        <span className="text-[10px] font-semibold uppercase tracking-wider shrink-0" style={{ color: "var(--text-muted)" }}>Tags</span>
        <div className="w-px h-4 shrink-0" style={{ backgroundColor: "var(--border)" }} />

        {/* Reorder button */}
        <button type="button" onClick={openReorder} title="Reorder tags"
          className="shrink-0 p-1 rounded text-xs transition-colors hover:bg-stone-100 dark:hover:bg-stone-800"
          style={{ color: "var(--text-muted)" }}>⇅</button>

        {/* Pending hint */}
        {pendingWordTag && (
          <span className="text-xs italic shrink-0 px-2 py-1 rounded"
            style={{ color: "var(--accent)", backgroundColor: `${TAG_PALETTE[0]}11` }}>
            Click a source word to name this tag by its lemma
          </span>
        )}

        {/* Tag chips */}
        {tags.map((t) => {
          const isActive    = t.id === activeTagId;
          const isHovered   = t.id === hoveredId;
          const isPendingDel = t.id === confirmDeleteId;
          const isHighlighted = highlightedTagIds.has(t.id);
          const isEditing   = t.id === editingTagId;
          const corpus      = corpusLabel(t);

          if (isEditing) {
            const isWordOrCluster = t.type === "word" || t.type === "cluster";
            return (
              <div key={t.id}
                className="flex flex-col gap-1.5 px-3 py-2 rounded-lg border shrink-0"
                style={{ borderColor: editColor, backgroundColor: "var(--surface-muted, var(--surface))", minWidth: "20rem" }}>
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: editColor }} />
                  <input autoFocus type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(); if (e.key === "Escape") setEditingTagId(null); }}
                    className="w-24 text-xs bg-transparent outline-none" style={{ color: "var(--foreground)" }} />
                  {colorSwatches(editColor, setEditColor)}
                </div>

                {/* Corpus selector for edit */}
                <CorpusSelector currentBook={currentBook} bookGroupings={bookGroupings}
                  corpusMode={editCorpusMode} corpusGroupingId={editCorpusGroupingId}
                  onSelect={(mode, gid) => { setEditCorpusMode(mode); setEditCorpusGroupingId(gid); }}
                  onCreateGrouping={handleCreateGroupingForEdit} />

                {/* Lemma editor for word/cluster */}
                {isWordOrCluster && (
                  <LemmaPickerInput
                    color={editColor}
                    lemmas={editLemmas}
                    pickingActive={clusterPickingActive}
                    onAdd={(lemma) => setEditLemmas((prev) => prev.includes(lemma) ? prev : [...prev, lemma])}
                    onRemove={(lemma) => setEditLemmas((prev) => prev.filter((x) => x !== lemma))}
                    onRequestWordClick={onRequestWordClick}
                    onCancelWordClick={onCancelWordClick}
                  />
                )}

                <div className="flex gap-2">
                  <button type="button" onClick={handleSaveEdit} disabled={!editName.trim()}
                    className="text-xs font-semibold px-1.5 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">Save</button>
                  <button type="button" onClick={() => setEditingTagId(null)}
                    className="text-xs px-1 py-0.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                    style={{ color: "var(--text-muted)" }}>Cancel</button>
                </div>
              </div>
            );
          }

          return (
            <button key={t.id} type="button"
              onClick={() => { setConfirmDeleteId(null); onSelectTag(t.id); }}
              onDoubleClick={() => handleStartEdit(t)}
              onMouseEnter={() => setHoveredId(t.id)}
              onMouseLeave={() => setHoveredId(null)}
              className="relative flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all shrink-0 border"
              style={{
                borderColor: isPendingDel ? "#ef4444" : isActive ? t.color : "var(--border)",
                backgroundColor: isPendingDel ? "#fef2f2" : isActive ? `${t.color}22` : "var(--surface)",
                color: "var(--foreground)",
                outline: !isPendingDel && isActive ? `2px solid ${t.color}` : "none",
                outlineOffset: "1px",
              }}>
              {isPendingDel ? (
                <>
                  <span className="text-xs font-medium text-red-600 dark:text-red-400 shrink-0">Delete?</span>
                  <span role="button" className="text-green-600 dark:text-green-400 hover:text-green-700 font-bold text-sm leading-none px-0.5 transition-colors"
                    onClick={(e) => { e.stopPropagation(); onDeleteTag(t.id); setConfirmDeleteId(null); }}>✓</span>
                  <span role="button" className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 text-sm leading-none px-0.5 transition-colors"
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}>✕</span>
                </>
              ) : (
                <>
                  <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                  {t.name}
                  {/* type badge */}
                  <span className="text-[9px] font-bold uppercase tracking-wider opacity-50 ml-0.5" style={{ color: t.color }}>
                    {typeBadge(t)}
                  </span>
                  {/* corpus grouping badge */}
                  {corpus && (
                    <span className="text-[8px] px-1 py-0.5 rounded-full leading-none opacity-60"
                      style={{ backgroundColor: `${t.color}33`, color: t.color }}>
                      {corpus}
                    </span>
                  )}
                  {/* highlight toggle */}
                  {(isHovered || isHighlighted) && (
                    <span className={`ml-0.5 text-sm leading-none cursor-pointer transition-colors ${isHighlighted ? "text-amber-400 hover:text-amber-500" : "text-stone-300 hover:text-amber-400"}`}
                      onClick={(e) => { e.stopPropagation(); onToggleHighlight(t.id); }}
                      title={isHighlighted ? "Remove highlight" : "Highlight all occurrences"}>✦</span>
                  )}
                  {/* delete button */}
                  {isHovered && (
                    <span className="ml-0.5 text-stone-400 hover:text-red-500 transition-colors cursor-pointer leading-none"
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(t.id); }}>×</span>
                  )}
                </>
              )}
            </button>
          );
        })}

        {/* + New form */}
        {!showNew ? (
          <button type="button" onClick={() => setShowNew(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-dashed transition-colors shrink-0 hover:border-blue-400 hover:text-blue-500"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>+ New</button>
        ) : (
          <div className="flex flex-col gap-2 px-3 py-2 rounded-lg border shrink-0"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-muted, var(--surface))", minWidth: "22rem" }}>

            {/* Type toggle */}
            <div className="flex items-center gap-1">
              <div className="flex rounded overflow-hidden border text-xs" style={{ borderColor: "var(--border)" }}>
                {(["concept", "word", "cluster"] as TagType[]).map((tp) => (
                  <button key={tp} type="button" onClick={() => { setNewType(tp); setNewLemmas([]); }}
                    className="px-2 py-0.5 capitalize transition-colors"
                    style={{ backgroundColor: newType === tp ? "var(--accent)" : "transparent", color: newType === tp ? "#fff" : "var(--text-muted)" }}>
                    {tp === "cluster" ? "Set of words" : tp}
                  </button>
                ))}
              </div>
            </div>

            {/* Name input */}
            {(newType === "concept" || newType === "cluster") && (
              <input autoFocus={newType === "concept"} type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && newType === "concept") handleCreate(); if (e.key === "Escape") { setShowNew(false); resetNew(); } }}
                placeholder={newType === "cluster" ? "Set name" : "Label"}
                className="w-full text-xs bg-transparent outline-none border-b pb-0.5"
                style={{ borderColor: "var(--border)", color: "var(--foreground)" }} />
            )}
            {newType === "word" && (
              <span className="text-xs italic" style={{ color: "var(--text-muted)" }}>Label will come from lemma</span>
            )}

            {/* Lemma inputs for cluster */}
            {newType === "cluster" && (
              <LemmaPickerInput
                color={newColor}
                lemmas={newLemmas}
                pickingActive={clusterPickingActive}
                onAdd={(lemma) => setNewLemmas((prev) => prev.includes(lemma) ? prev : [...prev, lemma])}
                onRemove={(lemma) => setNewLemmas((prev) => prev.filter((x) => x !== lemma))}
                onRequestWordClick={onRequestWordClick}
                onCancelWordClick={onCancelWordClick}
              />
            )}

            {/* Color + Corpus row */}
            <div className="flex items-center gap-2 flex-wrap">
              {colorSwatches(newColor, setNewColor)}
              <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: newColor }} />
            </div>

            <CorpusSelector currentBook={currentBook} bookGroupings={bookGroupings}
              corpusMode={newCorpusMode} corpusGroupingId={newCorpusGroupingId}
              onSelect={(mode, gid) => { setNewCorpusMode(mode); setNewCorpusGroupingId(gid); }}
              onCreateGrouping={handleCreateGroupingForNew} />

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <button type="button" onClick={handleCreate}
                disabled={(newType === "concept" && !newName.trim()) || (newType === "cluster" && (!newName.trim() || newLemmas.length === 0))}
                className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {newType === "word" ? "Create →" : "Create"}
              </button>
              <button type="button" onClick={() => { setShowNew(false); resetNew(); }}
                className="text-xs px-1.5 py-0.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                style={{ color: "var(--text-muted)" }}>Cancel</button>
              {newType === "cluster" && newLemmas.length === 0 && (
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Add at least one lemma</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Reorder dropdown */}
      {showReorder && (
        <div className="absolute top-full left-0 mt-1 z-50 rounded-lg border shadow-lg p-3 min-w-[200px]"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>Reorder Tags</span>
            <button type="button" onClick={() => setShowReorder(false)}
              className="text-xs px-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors leading-none"
              style={{ color: "var(--text-muted)" }}>✕</button>
          </div>
          <ul className="flex flex-col gap-1">
            {reorderList.map((t, idx) => (
              <li key={t.id} draggable onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)} onDragEnd={handleDragEnd}
                className="flex items-center gap-2 px-2 py-1.5 rounded cursor-grab active:cursor-grabbing select-none hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                style={{ color: "var(--foreground)" }}>
                <span className="text-stone-300 dark:text-stone-600 text-xs leading-none">⠿</span>
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                <span className="text-xs flex-1">{t.name}</span>
                <span className="text-[9px] font-bold uppercase opacity-40" style={{ color: t.color }}>
                  {typeBadge(t)}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 mt-3 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
            <button type="button" onClick={() => setShowReorder(false)}
              className="text-xs px-2 py-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
              style={{ color: "var(--text-muted)" }}>Cancel</button>
            <button type="button" onClick={handleSaveReorder}
              className="text-xs font-semibold px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors">Save order</button>
          </div>
        </div>
      )}
    </div>
  );
}
