"use client";

import { useState, useRef } from "react";
import type { WordTag } from "@/lib/db/schema";
import { RULE_PALETTE } from "@/lib/morphology/colorRules";

const TAG_PALETTE: string[] = [
  ...RULE_PALETTE,
  "#b91c1c", "#c2410c", "#a16207", "#166534",
  "#0f766e", "#1d4ed8", "#6d28d9", "#be185d",
];

interface WordTagPanelProps {
  tags: WordTag[];
  activeTagId: number | null;
  highlightedTagIds: Set<number>;
  pendingWordTag: boolean;
  onSelectTag: (id: number) => void;
  onCreateConceptTag: (name: string, color: string) => void;
  onCreatePendingWordTag: (color: string) => void;
  onDeleteTag: (id: number) => void;
  onUpdateTag: (id: number, name: string, color: string) => void;
  onReorder: (ids: number[]) => void;
  onToggleHighlight: (id: number) => void;
}

export default function WordTagPanel({
  tags,
  activeTagId,
  highlightedTagIds,
  pendingWordTag,
  onSelectTag,
  onCreateConceptTag,
  onCreatePendingWordTag,
  onDeleteTag,
  onUpdateTag,
  onReorder,
  onToggleHighlight,
}: WordTagPanelProps) {
  const [showNew, setShowNew] = useState(false);
  const [newType, setNewType] = useState<"word" | "concept">("concept");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(TAG_PALETTE[0]);

  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(TAG_PALETTE[0]);
  const [showReorder, setShowReorder] = useState(false);
  const [reorderList, setReorderList] = useState<WordTag[]>([]);
  const dragIdx = useRef<number | null>(null);

  function handleStartEdit(t: WordTag) {
    setEditingTagId(t.id);
    setEditName(t.name);
    setEditColor(t.color);
    setConfirmDeleteId(null);
  }

  function handleSaveEdit() {
    if (!editingTagId || !editName.trim()) return;
    onUpdateTag(editingTagId, editName.trim(), editColor);
    setEditingTagId(null);
  }

  function handleCreate() {
    if (newType === "concept") {
      if (!newName.trim()) return;
      onCreateConceptTag(newName.trim(), newColor);
    } else {
      onCreatePendingWordTag(newColor);
    }
    setNewName("");
    setNewColor(TAG_PALETTE[0]);
    setNewType("concept");
    setShowNew(false);
  }

  function openReorder() {
    setReorderList([...tags]);
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
    onReorder(reorderList.map((t) => t.id));
    setShowReorder(false);
  }

  const colorSwatches = (selected: string, onPick: (c: string) => void) => (
    <div className="flex flex-wrap gap-1" style={{ maxWidth: "10rem" }}>
      {TAG_PALETTE.map((col) => (
        <button
          key={col}
          type="button"
          onClick={() => onPick(col)}
          className="w-4 h-4 rounded-full transition-transform hover:scale-110"
          style={{
            backgroundColor: col,
            outline: selected === col ? `2px solid ${col}` : "none",
            outlineOffset: "1px",
          }}
        />
      ))}
      <input
        type="color"
        value={selected}
        onChange={(e) => onPick(e.target.value)}
        className="w-4 h-4 rounded-full cursor-pointer border-0 p-0 bg-transparent"
        title="Custom color"
      />
    </div>
  );

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
        Tags
      </span>

      <div className="w-px h-4 shrink-0" style={{ backgroundColor: "var(--border)" }} />

      {/* Reorder button */}
      <button
        type="button"
        onClick={openReorder}
        title="Reorder tags"
        className="shrink-0 p-1 rounded text-xs transition-colors hover:bg-stone-100 dark:hover:bg-stone-800"
        style={{ color: "var(--text-muted)" }}
      >
        ⇅
      </button>

      {/* Pending hint */}
      {pendingWordTag && (
        <span
          className="text-xs italic shrink-0 px-2 py-1 rounded"
          style={{ color: "var(--accent)", backgroundColor: `${TAG_PALETTE[0]}11` }}
        >
          Click a source word to name this tag by its lemma
        </span>
      )}

      {/* Tag chips */}
      {tags.map((t) => {
        const isActive = t.id === activeTagId;
        const isHovered = t.id === hoveredId;
        const isPendingDelete = t.id === confirmDeleteId;
        const isHighlighted = highlightedTagIds.has(t.id);
        const isEditing = t.id === editingTagId;

        if (isEditing) {
          return (
            <div
              key={t.id}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border shrink-0"
              style={{ borderColor: editColor, backgroundColor: "var(--surface-muted, var(--surface))" }}
            >
              <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: editColor }} />
              <input
                autoFocus
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(); if (e.key === "Escape") setEditingTagId(null); }}
                className="w-20 text-xs bg-transparent outline-none"
                style={{ color: "var(--foreground)" }}
              />
              {colorSwatches(editColor, setEditColor)}
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
                onClick={() => setEditingTagId(null)}
                className="text-xs px-1 py-0.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                style={{ color: "var(--text-muted)" }}
              >
                Cancel
              </button>
            </div>
          );
        }

        return (
          <button
            key={t.id}
            type="button"
            onClick={() => { setConfirmDeleteId(null); onSelectTag(t.id); }}
            onDoubleClick={() => handleStartEdit(t)}
            onMouseEnter={() => setHoveredId(t.id)}
            onMouseLeave={() => setHoveredId(null)}
            className="relative flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all shrink-0 border"
            style={{
              borderColor: isPendingDelete ? "#ef4444" : isActive ? t.color : "var(--border)",
              backgroundColor: isPendingDelete ? "#fef2f2" : isActive ? `${t.color}22` : "var(--surface)",
              color: "var(--foreground)",
              outline: !isPendingDelete && isActive ? `2px solid ${t.color}` : "none",
              outlineOffset: "1px",
            }}
          >
            {isPendingDelete ? (
              <>
                <span className="text-xs font-medium text-red-600 dark:text-red-400 shrink-0">Delete?</span>
                <span
                  role="button"
                  className="text-green-600 dark:text-green-400 hover:text-green-700 font-bold text-sm leading-none px-0.5 transition-colors"
                  onClick={(e) => { e.stopPropagation(); onDeleteTag(t.id); setConfirmDeleteId(null); }}
                >
                  ✓
                </span>
                <span
                  role="button"
                  className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 text-sm leading-none px-0.5 transition-colors"
                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                >
                  ✕
                </span>
              </>
            ) : (
              <>
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                {t.name}
                {/* type badge */}
                <span
                  className="text-[9px] font-bold uppercase tracking-wider opacity-50 ml-0.5"
                  style={{ color: t.color }}
                >
                  {t.type === "word" ? "W" : "C"}
                </span>
                {/* highlight toggle */}
                {(isHovered || isHighlighted) && (
                  <span
                    className={`ml-0.5 text-sm leading-none cursor-pointer transition-colors ${isHighlighted ? "text-amber-400 hover:text-amber-500" : "text-stone-300 hover:text-amber-400"}`}
                    onClick={(e) => { e.stopPropagation(); onToggleHighlight(t.id); }}
                    title={isHighlighted ? "Remove highlight" : "Highlight all occurrences"}
                  >
                    ✦
                  </span>
                )}
                {/* delete button */}
                {isHovered && (
                  <span
                    className="ml-0.5 text-stone-400 hover:text-red-500 transition-colors cursor-pointer leading-none"
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(t.id); }}
                  >
                    ×
                  </span>
                )}
              </>
            )}
          </button>
        );
      })}

      {/* + New form */}
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
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border shrink-0"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-muted, var(--surface))" }}
        >
          {/* Word / Concept toggle */}
          <div className="flex rounded overflow-hidden border text-xs" style={{ borderColor: "var(--border)" }}>
            {(["concept", "word"] as const).map((tp) => (
              <button
                key={tp}
                type="button"
                onClick={() => setNewType(tp)}
                className="px-2 py-0.5 capitalize transition-colors"
                style={{
                  backgroundColor: newType === tp ? "var(--accent)" : "transparent",
                  color: newType === tp ? "#fff" : "var(--text-muted)",
                }}
              >
                {tp}
              </button>
            ))}
          </div>

          {/* Name input (concept only) */}
          {newType === "concept" && (
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setShowNew(false); }}
              placeholder="Label"
              className="w-24 text-xs bg-transparent outline-none"
              style={{ color: "var(--foreground)" }}
            />
          )}
          {newType === "word" && (
            <span className="text-xs italic" style={{ color: "var(--text-muted)" }}>
              label from lemma
            </span>
          )}

          {colorSwatches(newColor, setNewColor)}
          <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: newColor }} />

          <button
            type="button"
            onClick={handleCreate}
            disabled={newType === "concept" && !newName.trim()}
            className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {newType === "word" ? "Create →" : "Create"}
          </button>
          <button
            type="button"
            onClick={() => { setShowNew(false); setNewName(""); setNewType("concept"); }}
            className="text-xs px-1.5 py-0.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
            style={{ color: "var(--text-muted)" }}
          >
            Cancel
          </button>
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
              Reorder Tags
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
            {reorderList.map((t, idx) => (
              <li
                key={t.id}
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
                  style={{ backgroundColor: t.color }}
                />
                <span className="text-xs flex-1">{t.name}</span>
                <span className="text-[9px] font-bold uppercase opacity-40" style={{ color: t.color }}>
                  {t.type === "word" ? "W" : "C"}
                </span>
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
