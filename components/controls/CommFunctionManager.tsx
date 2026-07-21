"use client";

import { useEffect, useState } from "react";
import {
  COMM_FUNCTION_TAXONOMY,
  useCommFunctionCustoms,
  type CommFunctionCategoryKey,
} from "@/components/text/CommunicativeFunctionPicker";

/** Inline rename form for an existing custom entry. */
function RenameForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (label: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!label.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(label.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
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
          className="px-1.5 py-0.5 rounded border text-[11px]"
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
      {error && <p className="text-[10px] text-red-500">{error}</p>}
    </div>
  );
}

/** Inline add-new form scoped to a single category. */
function AddForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (label: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!label.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(label.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1 mt-1">
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="text"
          placeholder="New function name"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
          className="px-1.5 py-0.5 rounded border text-[11px]"
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
      {error && <p className="text-[10px] text-red-500">{error}</p>}
    </div>
  );
}

export default function CommFunctionManager({ onClose }: { onClose: () => void }) {
  const { entries, addCustom, updateCustom, deleteCustom } = useCommFunctionCustoms();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [addingCat, setAddingCat] = useState<CommFunctionCategoryKey | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleDelete(id: number) {
    setDeleteError(null);
    try {
      await deleteCustom(id);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Failed to delete — please try again.");
    }
  }

  const categoryKeys = Object.keys(COMM_FUNCTION_TAXONOMY) as CommFunctionCategoryKey[];

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-xl rounded-lg shadow-xl border flex flex-col"
        style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="shrink-0 flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
            Manage Communicative Functions
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

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          {deleteError && <p className="text-xs text-red-500">{deleteError}</p>}
          {categoryKeys.map((catKey) => {
            const cat = COMM_FUNCTION_TAXONOMY[catKey];
            const customForCat = entries.filter((e) => e.category === catKey);
            return (
              <div key={catKey}>
                <div
                  className="text-[11px] font-semibold uppercase tracking-wide mb-1.5"
                  style={{ color: "var(--text-muted)" }}
                >
                  {cat.label}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.values(cat.children).map((label) => (
                    <span
                      key={label}
                      className="text-[11px] px-2 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400"
                    >
                      {label}
                    </span>
                  ))}
                  {customForCat.map((entry) =>
                    editingId === entry.id ? (
                      <RenameForm
                        key={entry.id}
                        initial={entry.label}
                        onSubmit={async (label) => { await updateCustom(entry.id, label); setEditingId(null); }}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <span
                        key={entry.id}
                        className="group inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                      >
                        {entry.label}
                        <button
                          type="button"
                          onClick={() => setEditingId(entry.id)}
                          className="opacity-0 group-hover:opacity-100 hover:text-indigo-900 dark:hover:text-indigo-100 transition-opacity"
                          title="Edit"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(entry.id)}
                          className="opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity"
                          title="Delete"
                        >
                          ×
                        </button>
                      </span>
                    )
                  )}
                </div>

                {addingCat === catKey ? (
                  <AddForm
                    onSubmit={async (label) => { await addCustom(catKey, label); setAddingCat(null); }}
                    onCancel={() => setAddingCat(null)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => { setAddingCat(catKey); setEditingId(null); }}
                    className="mt-1 text-[10px] text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                  >
                    + Add
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
