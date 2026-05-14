"use client";

import { useRef, useState } from "react";
import type { InterlinearSubMode } from "@/lib/morphology/types";

interface Dataset {
  id: number;
  name: string;
}

interface InterlinearSubModePickerProps {
  subMode: InterlinearSubMode;
  onChange: (mode: InterlinearSubMode) => void;
  datasets: Dataset[];
  onCreateDataset: (name: string) => Promise<Dataset | null>;
  onDeleteDataset: (id: number) => void;
  onRenameDataset: (id: number, name: string) => void;
  onUploadDataset: (id: number) => void;
}

type SimpleMode = "lemma" | "strongs" | "morph" | "constituent";

const SIMPLE_MODES: { value: SimpleMode; label: string; title: string }[] = [
  { value: "lemma",       label: "Lemma",       title: "Show dictionary form" },
  { value: "strongs",     label: "Strong's",    title: "Show Strong's numbers" },
  { value: "morph",       label: "Morph",       title: "Show morphology code" },
  { value: "constituent", label: "Constituent", title: "Show grammatical constituent labels" },
];

function activeDatasetId(mode: InterlinearSubMode): number | null {
  return typeof mode === "object" && mode.type === "dataset" ? mode.id : null;
}

export default function InterlinearSubModePicker({
  subMode,
  onChange,
  datasets,
  onCreateDataset,
  onDeleteDataset,
  onRenameDataset,
  onUploadDataset,
}: InterlinearSubModePickerProps) {
  const [dsMenuOpen, setDsMenuOpen]     = useState(false);
  const [creating,   setCreating]       = useState(false);
  const [newName,    setNewName]        = useState("");
  const [renamingId, setRenamingId]     = useState<number | null>(null);
  const [renameVal,  setRenameVal]      = useState("");
  const menuRef                          = useRef<HTMLDivElement>(null);
  const createInputRef                   = useRef<HTMLInputElement>(null);
  const renameInputRef                   = useRef<HTMLInputElement>(null);

  const activeDs = activeDatasetId(subMode);
  const currentSimple = typeof subMode === "string" ? subMode : null;

  const btnBase =
    "px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap";
  const btnActive =
    "bg-blue-600 text-white";
  const btnIdle =
    "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700";

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const ds = await onCreateDataset(name);
    if (ds) {
      onChange({ type: "dataset", id: ds.id, name: ds.name });
      setNewName("");
      setCreating(false);
    }
  }

  function handleRename(id: number) {
    const val = renameVal.trim();
    if (val) onRenameDataset(id, val);
    setRenamingId(null);
    setRenameVal("");
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="text-xs text-stone-400 dark:text-stone-500 mr-0.5">Show:</span>

      {/* ── Simple modes ──────────────────────────────────────────────────── */}
      {SIMPLE_MODES.map(({ value, label, title }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          title={title}
          className={[btnBase, currentSimple === value ? btnActive : btnIdle].join(" ")}
        >
          {label}
        </button>
      ))}

      {/* ── Dataset picker ────────────────────────────────────────────────── */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setDsMenuOpen((v) => !v)}
          title="User-created word datasets"
          className={[
            btnBase,
            "flex items-center gap-1",
            activeDs != null ? btnActive : btnIdle,
          ].join(" ")}
        >
          {activeDs != null
            ? (typeof subMode === "object" && subMode.type === "dataset" ? subMode.name : "Dataset")
            : "Datasets"}
          <span className="opacity-70">▾</span>
        </button>

        {dsMenuOpen && (
          <div
            className="absolute left-0 top-full mt-1 z-50 rounded-lg border shadow-lg py-1 min-w-[200px]"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
          >
            {datasets.length === 0 && !creating && (
              <p className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                No datasets yet.
              </p>
            )}

            {datasets.map((ds) => (
              <div key={ds.id} className="flex items-center gap-1 px-2 py-1 group">
                {renamingId === ds.id ? (
                  <input
                    ref={renameInputRef}
                    autoFocus
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(ds.id);
                      if (e.key === "Escape") { setRenamingId(null); setRenameVal(""); }
                    }}
                    onBlur={() => handleRename(ds.id)}
                    className="flex-1 rounded border px-1.5 py-0.5 text-xs outline-none"
                    style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
                  />
                ) : (
                  <button
                    className={[
                      "flex-1 text-left text-xs px-1.5 py-0.5 rounded",
                      activeDs === ds.id
                        ? "font-semibold text-blue-600 dark:text-blue-400"
                        : "hover:bg-stone-100 dark:hover:bg-stone-700",
                    ].join(" ")}
                    style={{ color: activeDs === ds.id ? undefined : "var(--foreground)" }}
                    onClick={() => { onChange({ type: "dataset", id: ds.id, name: ds.name }); setDsMenuOpen(false); }}
                  >
                    {ds.name}
                  </button>
                )}
                {renamingId !== ds.id && (
                  <span className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      title="Upload entries from file"
                      className="text-[10px] px-1 py-0.5 rounded hover:bg-stone-100 dark:hover:bg-stone-700"
                      style={{ color: "var(--text-muted)" }}
                      onClick={() => { onUploadDataset(ds.id); setDsMenuOpen(false); }}
                    >⬆</button>
                    <button
                      title="Rename"
                      className="text-[10px] px-1 py-0.5 rounded hover:bg-stone-100 dark:hover:bg-stone-700"
                      style={{ color: "var(--text-muted)" }}
                      onClick={() => { setRenamingId(ds.id); setRenameVal(ds.name); }}
                    >✎</button>
                    <button
                      title="Delete dataset"
                      className="text-[10px] px-1 py-0.5 rounded hover:bg-red-100 dark:hover:bg-red-950 text-red-500"
                      onClick={() => { onDeleteDataset(ds.id); if (activeDs === ds.id) onChange("lemma"); setDsMenuOpen(false); }}
                    >✕</button>
                  </span>
                )}
              </div>
            ))}

            <div className="border-t mt-1 pt-1" style={{ borderColor: "var(--border)" }}>
              {creating ? (
                <div className="flex items-center gap-1 px-2 py-1">
                  <input
                    ref={createInputRef}
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Dataset name"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreate();
                      if (e.key === "Escape") { setCreating(false); setNewName(""); }
                    }}
                    className="flex-1 rounded border px-1.5 py-0.5 text-xs outline-none"
                    style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
                  />
                  <button
                    onClick={handleCreate}
                    className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white"
                  >Add</button>
                </div>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="w-full text-left text-xs px-3 py-1 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
                  style={{ color: "var(--text-muted)" }}
                >
                  + New dataset
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
