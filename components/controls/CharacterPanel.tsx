"use client";

import { useState, useRef } from "react";
import type { Character, BookGrouping } from "@/lib/db/schema";
import {
  TAG_PALETTE, ColorSwatches, CorpusSelector, LemmaPickerInput,
  type CorpusAssignment, type CorpusPassageOption,
} from "./WordTagPanel";

const DEFAULT_CORPUS: CorpusAssignment = { mode: "book", groupingId: null, chapter: null, passageId: null };

interface CharacterPanelProps {
  characters: Character[];
  activeCharacterId: number | null;
  mode: "refs" | "speech";
  currentBook: string;
  currentChapter?: number;
  currentPassages?: CorpusPassageOption[];
  bookGroupings: BookGrouping[];
  clusterPickingActive: boolean;
  onSelectCharacter: (id: number) => void;
  onCreateCharacter: (name: string, color: string, corpus: CorpusAssignment, lemmas: string[], corpusBooks: string[]) => void;
  onDeleteCharacter: (id: number) => void;
  onUpdateCharacter: (
    id: number, name: string, color: string,
    corpus: CorpusAssignment, lemmas: string[] | null, prevLemmas: string[] | null, corpusBooks: string[],
  ) => void;
  onReorder: (ids: number[]) => void;
  highlightedCharIds: Set<number>;
  onToggleHighlight: (id: number) => void;
  onCreateGrouping: (name: string, books: string[], features: string[]) => Promise<BookGrouping>;
  onRequestWordClick: (onPicked: (lemma: string, displayLabel?: string) => void) => void;
  onCancelWordClick: () => void;
}

export default function CharacterPanel({
  characters,
  activeCharacterId,
  mode,
  currentBook,
  currentChapter,
  currentPassages,
  bookGroupings,
  clusterPickingActive,
  onSelectCharacter,
  onCreateCharacter,
  onDeleteCharacter,
  onUpdateCharacter,
  onReorder,
  highlightedCharIds,
  onToggleHighlight,
  onCreateGrouping,
  onRequestWordClick,
  onCancelWordClick,
}: CharacterPanelProps) {
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(TAG_PALETTE[0]);
  const [newLemmas, setNewLemmas] = useState<string[]>([]);
  const [newCorpus, setNewCorpus] = useState<CorpusAssignment>(DEFAULT_CORPUS);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [editingCharId, setEditingCharId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(TAG_PALETTE[0]);
  const [editCorpus, setEditCorpus] = useState<CorpusAssignment>(DEFAULT_CORPUS);
  const [editLemmas, setEditLemmas] = useState<string[]>([]);
  const editOriginalLemmasRef = useRef<string[]>([]);
  const [showReorder, setShowReorder] = useState(false);
  // Local drag-ordered list — initialised from props when menu opens
  const [reorderList, setReorderList] = useState<Character[]>([]);
  const dragIdx = useRef<number | null>(null);

  function resolveCorpusBooks(corpus: CorpusAssignment): string[] {
    if (corpus.mode === "grouping" && corpus.groupingId != null) {
      const g = bookGroupings.find((g) => g.id === corpus.groupingId);
      if (g) {
        try { return JSON.parse(g.books) as string[]; } catch { return [currentBook]; }
      }
    }
    return [currentBook];
  }

  function handleStartEdit(c: Character) {
    setEditingCharId(c.id);
    setEditName(c.name);
    setEditColor(c.color);
    setEditCorpus({
      mode: (c.corpusType as CorpusAssignment["mode"] | undefined) ?? "book",
      groupingId: c.corpusGroupingId ?? null,
      chapter: c.corpusChapter ?? null,
      passageId: c.corpusPassageId ?? null,
    });
    const parsed = c.lemmas ? (() => { try { return JSON.parse(c.lemmas!) as string[]; } catch { return []; } })() : [];
    setEditLemmas(parsed);
    editOriginalLemmasRef.current = parsed;
    setConfirmDeleteId(null);
  }

  function handleSaveEdit() {
    if (!editingCharId || !editName.trim()) return;
    const corpusBooks = resolveCorpusBooks(editCorpus);
    onUpdateCharacter(
      editingCharId, editName.trim(), editColor, editCorpus,
      editLemmas.length > 0 ? editLemmas : null, editOriginalLemmasRef.current, corpusBooks,
    );
    setEditingCharId(null);
  }

  function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const corpusBooks = resolveCorpusBooks(newCorpus);
    onCreateCharacter(trimmed, newColor, newCorpus, newLemmas, corpusBooks);
    setNewName("");
    setNewColor(TAG_PALETTE[0]);
    setNewLemmas([]);
    setNewCorpus(DEFAULT_CORPUS);
    setShowNew(false);
  }

  async function handleCreateGroupingForNew(name: string, booksArr: string[]) {
    const g = await onCreateGrouping(name, booksArr, ["characters"]);
    setNewCorpus({ mode: "grouping", groupingId: g.id, chapter: null, passageId: null });
  }

  async function handleCreateGroupingForEdit(name: string, booksArr: string[]) {
    const g = await onCreateGrouping(name, booksArr, ["characters"]);
    setEditCorpus({ mode: "grouping", groupingId: g.id, chapter: null, passageId: null });
  }

  const corpusLabel = (c: Character) => {
    if (!c.corpusGroupingId) return null;
    const g = bookGroupings.find((g) => g.id === c.corpusGroupingId);
    return g ? g.name : null;
  };

  function openReorder() {
    setReorderList([...characters]);
    setShowReorder(true);
  }

  function handleDragStart(idx: number) {
    dragIdx.current = idx;
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    const next = [...reorderList];
    const [moved] = next.splice(dragIdx.current, 1);
    next.splice(idx, 0, moved);
    dragIdx.current = idx;
    setReorderList(next);
  }

  function handleDragEnd() {
    dragIdx.current = null;
  }

  function handleSaveReorder() {
    onReorder(reorderList.map((c) => c.id));
    setShowReorder(false);
  }

  return (
    <div
      className="shrink-0 border-t relative"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
    <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto">
      {/* Mode label */}
      <span
        className="text-[10px] font-semibold uppercase tracking-wider shrink-0"
        style={{ color: "var(--text-muted)" }}
      >
        {mode === "refs" ? "Refs" : "Speech"}
      </span>

      <div className="w-px h-4 shrink-0" style={{ backgroundColor: "var(--border)" }} />

      {/* Reorder button */}
      <button
        type="button"
        onClick={openReorder}
        title="Reorder characters"
        className="shrink-0 p-1 rounded text-xs transition-colors hover:bg-stone-100 dark:hover:bg-stone-800"
        style={{ color: "var(--text-muted)" }}
      >
        ⇅
      </button>

      {/* Character chips */}
      {characters.map((c) => {
        const isActive = c.id === activeCharacterId;
        const isHovered = c.id === hoveredId;
        const isPendingDelete = c.id === confirmDeleteId;
        const isHighlighted = highlightedCharIds.has(c.id);
        const isEditing = c.id === editingCharId;

        // ── Inline edit form ──────────────────────────────────────────────
        if (isEditing) {
          return (
            <div
              key={c.id}
              className="flex flex-col gap-1.5 px-3 py-2 rounded-lg border shrink-0"
              style={{ borderColor: editColor, backgroundColor: "var(--surface-muted, var(--surface))", minWidth: "20rem" }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: editColor }}
                />
                <input
                  autoFocus
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveEdit();
                    if (e.key === "Escape") setEditingCharId(null);
                  }}
                  className="w-24 text-xs bg-transparent outline-none"
                  style={{ color: "var(--foreground)" }}
                />
                <ColorSwatches selected={editColor} onPick={setEditColor} />
              </div>

              <CorpusSelector currentBook={currentBook} currentChapter={currentChapter} currentPassages={currentPassages}
                bookGroupings={bookGroupings}
                corpusMode={editCorpus.mode} corpusGroupingId={editCorpus.groupingId}
                corpusChapter={editCorpus.chapter} corpusPassageId={editCorpus.passageId}
                onSelect={setEditCorpus}
                onCreateGrouping={handleCreateGroupingForEdit} />

              <LemmaPickerInput
                color={editColor}
                lemmas={editLemmas}
                pickingActive={clusterPickingActive}
                onAdd={(lemma) => setEditLemmas((prev) => prev.includes(lemma) ? prev : [...prev, lemma])}
                onRemove={(lemma) => setEditLemmas((prev) => prev.filter((x) => x !== lemma))}
                onRequestWordClick={onRequestWordClick}
                onCancelWordClick={onCancelWordClick}
              />

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={!editName.trim()}
                  className="text-xs font-semibold px-1.5 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingCharId(null)}
                  className="text-xs px-1 py-0.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                  style={{ color: "var(--text-muted)" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        }

        return (
          <button
            key={c.id}
            type="button"
            onClick={() => { setConfirmDeleteId(null); onSelectCharacter(c.id); }}
            onDoubleClick={() => handleStartEdit(c)}
            onMouseEnter={() => setHoveredId(c.id)}
            onMouseLeave={() => setHoveredId(null)}
            title={isPendingDelete ? undefined : `${c.name} (double-click to edit, right-click to delete)`}
            className="relative flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all shrink-0 border"
            style={{
              borderColor: isPendingDelete ? "#ef4444" : isActive ? c.color : "var(--border)",
              backgroundColor: isPendingDelete ? "#fef2f2" : isActive ? `${c.color}22` : "var(--surface)",
              color: "var(--foreground)",
              outline: !isPendingDelete && isActive ? `2px solid ${c.color}` : "none",
              outlineOffset: "1px",
            }}
          >
            {isPendingDelete ? (
              /* Inline delete confirmation */
              <>
                <span className="text-xs font-medium text-red-600 dark:text-red-400 shrink-0">
                  Delete?
                </span>
                <span
                  role="button"
                  className="text-green-600 dark:text-green-400 hover:text-green-700 font-bold text-sm leading-none px-0.5 transition-colors"
                  title="Confirm delete"
                  onClick={(e) => { e.stopPropagation(); onDeleteCharacter(c.id); setConfirmDeleteId(null); }}
                >
                  ✓
                </span>
                <span
                  role="button"
                  className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 text-sm leading-none px-0.5 transition-colors"
                  title="Cancel"
                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                >
                  ✕
                </span>
              </>
            ) : (
              /* Normal chip content */
              <>
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: c.color }}
                />
                {c.name}
                {/* corpus grouping badge */}
                {corpusLabel(c) && (
                  <span className="text-[8px] px-1 py-0.5 rounded-full leading-none opacity-60"
                    style={{ backgroundColor: `${c.color}33`, color: c.color }}>
                    {corpusLabel(c)}
                  </span>
                )}
                {/* ✦ highlight toggle — always visible when on, hover-only when off */}
                {(isHovered || isHighlighted) && (
                  <span
                    className={[
                      "ml-0.5 text-sm leading-none cursor-pointer transition-colors",
                      isHighlighted
                        ? "text-amber-400 hover:text-amber-500"
                        : "text-stone-300 hover:text-amber-400",
                    ].join(" ")}
                    onClick={(e) => { e.stopPropagation(); onToggleHighlight(c.id); }}
                    title={isHighlighted ? "Remove highlight" : "Highlight all occurrences"}
                    aria-label={isHighlighted ? `Remove highlight for ${c.name}` : `Highlight ${c.name}`}
                  >
                    ✦
                  </span>
                )}
                {/* × delete button on hover */}
                {isHovered && (
                  <span
                    className="ml-0.5 text-stone-400 hover:text-red-500 transition-colors cursor-pointer leading-none"
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(c.id); }}
                    aria-label={`Delete ${c.name}`}
                  >
                    ×
                  </span>
                )}
              </>
            )}
          </button>
        );
      })}

      {/* + New / inline form */}
      {!showNew ? (
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-dashed transition-colors shrink-0 hover:border-blue-400 hover:text-blue-500"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          + New
        </button>
      ) : (
        <div
          className="flex flex-col gap-2 px-3 py-2 rounded-lg border shrink-0"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-muted, var(--surface))", minWidth: "20rem" }}
        >
          {/* Name input */}
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setShowNew(false); }}
            placeholder="Name"
            className="w-full text-xs bg-transparent outline-none border-b pb-0.5"
            style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
          />

          <LemmaPickerInput
            color={newColor}
            lemmas={newLemmas}
            pickingActive={clusterPickingActive}
            onAdd={(lemma) => setNewLemmas((prev) => prev.includes(lemma) ? prev : [...prev, lemma])}
            onRemove={(lemma) => setNewLemmas((prev) => prev.filter((x) => x !== lemma))}
            onRequestWordClick={onRequestWordClick}
            onCancelWordClick={onCancelWordClick}
          />

          {/* Color + preview */}
          <div className="flex items-center gap-2 flex-wrap">
            <ColorSwatches selected={newColor} onPick={setNewColor} />
            <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: newColor }} />
          </div>

          <CorpusSelector currentBook={currentBook} currentChapter={currentChapter} currentPassages={currentPassages}
            bookGroupings={bookGroupings}
            corpusMode={newCorpus.mode} corpusGroupingId={newCorpus.groupingId}
            corpusChapter={newCorpus.chapter} corpusPassageId={newCorpus.passageId}
            onSelect={setNewCorpus}
            onCreateGrouping={handleCreateGroupingForNew} />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={!newName.trim()}
              className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowNew(false)}
              className="text-xs px-1.5 py-0.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

    </div>

      {/* Reorder dropdown */}
      {showReorder && (
        <div
          className="absolute top-full left-0 mt-1 z-50 rounded-lg border shadow-lg p-3 min-w-[200px]"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>
              Reorder Characters
            </span>
            <button
              type="button"
              onClick={() => setShowReorder(false)}
              className="text-xs px-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors leading-none"
              style={{ color: "var(--text-muted)" }}
            >
              ✕
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {reorderList.map((c, idx) => (
              <li
                key={c.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={handleDragEnd}
                className="flex items-center gap-2 px-2 py-1.5 rounded cursor-grab active:cursor-grabbing select-none hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                style={{ color: "var(--foreground)" }}
              >
                <span className="text-stone-300 dark:text-stone-600 text-xs leading-none">⠿</span>
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: c.color }}
                />
                <span className="text-xs flex-1">{c.name}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 mt-3 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
            <button
              type="button"
              onClick={() => setShowReorder(false)}
              className="text-xs px-2 py-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveReorder}
              className="text-xs font-semibold px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              Save order
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
