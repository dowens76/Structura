"use client";

import { useState } from "react";
import type { Character } from "@/lib/db/schema";
import { RULE_PALETTE } from "@/lib/morphology/colorRules";

// Extended palette: RULE_PALETTE + 8 darker/earthy tones
const CHARACTER_PALETTE: string[] = [
  ...RULE_PALETTE,
  "#b91c1c", // dark red
  "#c2410c", // dark orange
  "#a16207", // dark yellow
  "#166534", // dark green
  "#0f766e", // dark teal
  "#1d4ed8", // dark blue
  "#6d28d9", // dark violet
  "#be185d", // dark pink
];

interface CharacterPanelProps {
  characters: Character[];
  activeCharacterId: number | null;
  mode: "refs" | "speech";
  onSelectCharacter: (id: number) => void;
  onCreateCharacter: (name: string, color: string) => void;
  onDeleteCharacter: (id: number) => void;
  onUpdateCharacter: (id: number, name: string, color: string) => void;
  highlightedCharIds: Set<number>;
  onToggleHighlight: (id: number) => void;
}

export default function CharacterPanel({
  characters,
  activeCharacterId,
  mode,
  onSelectCharacter,
  onCreateCharacter,
  onDeleteCharacter,
  onUpdateCharacter,
  highlightedCharIds,
  onToggleHighlight,
}: CharacterPanelProps) {
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(CHARACTER_PALETTE[0]);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [editingCharId, setEditingCharId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(CHARACTER_PALETTE[0]);

  function handleStartEdit(c: Character) {
    setEditingCharId(c.id);
    setEditName(c.name);
    setEditColor(c.color);
    setConfirmDeleteId(null);
  }

  function handleSaveEdit() {
    if (!editingCharId || !editName.trim()) return;
    onUpdateCharacter(editingCharId, editName.trim(), editColor);
    setEditingCharId(null);
  }

  function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onCreateCharacter(trimmed, newColor);
    setNewName("");
    setNewColor(CHARACTER_PALETTE[0]);
    setShowNew(false);
  }

  return (
    <div
      className="shrink-0 border-t flex items-center gap-2 px-4 py-2 overflow-x-auto"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      {/* Mode label */}
      <span
        className="text-[10px] font-semibold uppercase tracking-wider shrink-0"
        style={{ color: "var(--text-muted)" }}
      >
        {mode === "refs" ? "Refs" : "Speech"}
      </span>

      <div className="w-px h-4 shrink-0" style={{ backgroundColor: "var(--border)" }} />

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
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border shrink-0"
              style={{ borderColor: editColor, backgroundColor: "var(--surface-muted, var(--surface))" }}
            >
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
                className="w-20 text-xs bg-transparent outline-none"
                style={{ color: "var(--foreground)" }}
              />
              <div className="flex flex-wrap gap-1" style={{ maxWidth: "8rem" }}>
                {CHARACTER_PALETTE.map((col) => (
                  <button
                    key={col}
                    type="button"
                    onClick={() => setEditColor(col)}
                    className="w-3.5 h-3.5 rounded-full transition-transform hover:scale-110"
                    style={{
                      backgroundColor: col,
                      outline: editColor === col ? `2px solid ${col}` : "none",
                      outlineOffset: "1px",
                    }}
                  />
                ))}
                <input
                  type="color"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                  className="w-3.5 h-3.5 rounded-full cursor-pointer border-0 p-0 bg-transparent"
                  title="Custom color"
                />
              </div>
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
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border shrink-0"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-muted, var(--surface))" }}
        >
          {/* Name input */}
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setShowNew(false); }}
            placeholder="Name"
            className="w-24 text-xs bg-transparent outline-none"
            style={{ color: "var(--foreground)" }}
          />

          {/* Color swatches */}
          <div className="flex flex-wrap gap-1" style={{ maxWidth: "10rem" }}>
            {CHARACTER_PALETTE.map((col) => (
              <button
                key={col}
                type="button"
                onClick={() => setNewColor(col)}
                className="w-4 h-4 rounded-full transition-transform hover:scale-110"
                style={{
                  backgroundColor: col,
                  outline: newColor === col ? `2px solid ${col}` : "none",
                  outlineOffset: "1px",
                }}
                title={col}
              />
            ))}
            {/* Custom color picker */}
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="w-4 h-4 rounded-full cursor-pointer border-0 p-0 bg-transparent"
              title="Custom color"
            />
          </div>

          {/* Preview dot */}
          <span
            className="inline-block w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: newColor }}
          />

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
      )}
    </div>
  );
}
