"use client";

import { useEffect, useRef, useState } from "react";
import { useSynopticCategories } from "@/lib/hooks/useSynopticCategories";
import { ANNOTATION_PALETTE } from "@/lib/utils/annotations";
import type { SynopticCategoryType } from "@/lib/db/schema";

function SwatchGrid({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-[3px]">
      {ANNOTATION_PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onChange(c); }}
          style={{
            backgroundColor: c,
            width: 16,
            height: 16,
            borderRadius: 3,
            outline: value === c ? "2px solid white" : "none",
            outlineOffset: 1,
            boxShadow: value === c ? `0 0 0 2px ${c}` : "none",
            flexShrink: 0,
          }}
          title={c}
        />
      ))}
    </div>
  );
}

/** Inline rename/recolor form for an existing category. */
function EditForm({
  initialLabel,
  initialColor,
  onSubmit,
  onCancel,
}: {
  initialLabel: string;
  initialColor: string;
  onSubmit: (label: string, color: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [color, setColor] = useState(initialColor);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!label.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(label.trim(), color);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 p-2 rounded border" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
          className="px-1.5 py-0.5 rounded border text-[11px] flex-1"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
        />
        <button
          type="button"
          disabled={!label.trim() || saving}
          onClick={submit}
          className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-600 text-white disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] px-1.5 py-0.5 rounded bg-stone-200 dark:bg-stone-700 text-stone-600 dark:text-stone-300"
        >
          Cancel
        </button>
      </div>
      <SwatchGrid value={color} onChange={setColor} />
      {error && <p className="text-[10px] text-red-500">{error}</p>}
    </div>
  );
}

/** Inline add-new-category form. */
function AddForm({ onSubmit, onCancel }: { onSubmit: (label: string, color: string) => Promise<void>; onCancel: () => void }) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<string>(ANNOTATION_PALETTE[0]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!label.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(label.trim(), color);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 p-2 rounded border mt-2" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="text"
          placeholder="New category name"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
          className="px-1.5 py-0.5 rounded border text-[11px] flex-1"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
        />
        <button
          type="button"
          disabled={!label.trim() || saving}
          onClick={submit}
          className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-600 text-white disabled:opacity-40"
        >
          {saving ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] px-1.5 py-0.5 rounded bg-stone-200 dark:bg-stone-700 text-stone-600 dark:text-stone-300"
        >
          Cancel
        </button>
      </div>
      <SwatchGrid value={color} onChange={setColor} />
      {error && <p className="text-[10px] text-red-500">{error}</p>}
    </div>
  );
}

/**
 * Manages the small, workspace-scoped list of "Synoptic comparison" annotation
 * categories (default: Shared Across All / Shared By Some / Unique to This
 * Column). Unlike the RST/comm-function taxonomies, there is no fixed
 * built-in set here — every row, including the 3 shipped defaults, is an
 * ordinary editable DB row (see synopticCategoryTypes in lib/db/user-schema.ts).
 */
export default function SynopticCategoryManager({ onClose }: { onClose: () => void }) {
  const { categories, addCategory, updateCategory, deleteCategory, reorderCategories } = useSynopticCategories();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local working order for drag-and-drop — kept in sync with the shared
  // categories list, but reordered visually as the user drags (see
  // handleDragOver) before the final order is persisted on drop.
  const [order, setOrder] = useState<SynopticCategoryType[]>(categories);
  useEffect(() => { setOrder(categories); }, [categories]);
  const dragIdx = useRef<number | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleDelete(id: number) {
    setError(null);
    try {
      await deleteCategory(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete — please try again.");
    }
  }

  function handleDragStart(idx: number) {
    dragIdx.current = idx;
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    const from = dragIdx.current;
    setOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    dragIdx.current = idx;
  }

  async function handleDragEnd() {
    if (dragIdx.current === null) return;
    dragIdx.current = null;
    setError(null);
    try {
      await reorderCategories(order.map((c) => c.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save order — please try again.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-lg shadow-xl border flex flex-col"
        style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
            Manage Synoptic Categories
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xl leading-none opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: "var(--foreground)" }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-2">
          {error && <p className="text-xs text-red-500">{error}</p>}
          {order.map((cat, idx) =>
            editingId === cat.id ? (
              <EditForm
                key={cat.id}
                initialLabel={cat.label}
                initialColor={cat.color}
                onSubmit={async (label, color) => { await updateCategory(cat.id, { label, color }); setEditingId(null); }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div
                key={cat.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={handleDragEnd}
                className="group flex items-center gap-2 px-2 py-1.5 rounded cursor-grab active:cursor-grabbing select-none"
                style={{ backgroundColor: "var(--surface)" }}
              >
                <span className="text-stone-300 dark:text-stone-600 text-xs leading-none shrink-0">⠿</span>
                <div className="w-3.5 h-3.5 rounded shrink-0" style={{ backgroundColor: cat.color }} />
                <span className="text-[12px] flex-1" style={{ color: "var(--foreground)" }}>{cat.label}</span>
                <button
                  type="button"
                  onClick={() => setEditingId(cat.id)}
                  className="opacity-0 group-hover:opacity-100 hover:text-indigo-600 dark:hover:text-indigo-400 transition-opacity text-[11px]"
                  title="Edit"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(cat.id)}
                  className="opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity text-[11px]"
                  title="Delete"
                >
                  ×
                </button>
              </div>
            )
          )}

          {adding ? (
            <AddForm
              onSubmit={async (label, color) => { await addCategory(label, color); setAdding(false); }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-1 text-[11px] text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
            >
              + Add category
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
