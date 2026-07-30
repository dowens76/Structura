"use client";

import { useRef, useState } from "react";
import type { InterlinearSubMode } from "@/lib/morphology/types";
import { CONSTITUENT_LABELS } from "@/lib/morphology/types";
import { DATASET_GROUP_SWATCHES } from "@/lib/utils/datasetColors";

interface Dataset {
  id: number;
  name: string;
  direction: "ltr" | "rtl";
}

interface InterlinearSubModePickerProps {
  subMode: InterlinearSubMode;
  onChange: (mode: InterlinearSubMode) => void;
  datasets: Dataset[];
  onCreateDataset: (name: string, direction: "ltr" | "rtl") => Promise<Dataset | null>;
  onDeleteDataset: (id: number) => void;
  onRenameDataset: (id: number, name: string) => void;
  onSetDatasetDirection: (id: number, direction: "ltr" | "rtl") => void;
  onUploadDataset: (id: number) => void;
  // Copy transliteration
  minVerse?: number;
  maxVerse?: number;
  onCopyTransliteration?: (opts: { format: "interlinear" | "running"; startVerse: number; endVerse: number }) => Promise<void>;
  // Word grouping (manual multi-word grouping within a dataset)
  groupingMode?: "off" | "new" | "edit";
  onToggleNewGrouping?: () => void;
  onToggleEditGrouping?: () => void;
  pendingGroupCount?: number;
  isEditingExistingGroup?: boolean;
  groupDraftValue?: string;
  onGroupDraftValueChange?: (value: string) => void;
  onSaveGrouping?: () => void;
  onDeleteGrouping?: () => void;
  // Color override for the label value currently in groupDraftValue; null
  // means it uses its auto-assigned color.
  labelColor?: string | null;
  onSetLabelColor?: (color: string | null) => void;
}

type SimpleMode = "lemma" | "strongs" | "morph" | "transliteration" | "constituent";

const SIMPLE_MODES: { value: SimpleMode; label: string; title: string }[] = [
  { value: "lemma",           label: "Lemma",       title: "Show dictionary form" },
  { value: "strongs",         label: "Strong's",    title: "Show Strong's numbers" },
  { value: "morph",           label: "Morph",       title: "Show morphology code" },
  { value: "transliteration", label: "Translit.",   title: "Show SBL academic transliteration" },
  { value: "constituent",     label: "Constituent", title: "Show grammatical constituent labels" },
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
  onSetDatasetDirection,
  onUploadDataset,
  minVerse = 1,
  maxVerse = 1,
  onCopyTransliteration,
  groupingMode = "off",
  onToggleNewGrouping,
  onToggleEditGrouping,
  pendingGroupCount = 0,
  isEditingExistingGroup = false,
  groupDraftValue = "",
  onGroupDraftValueChange,
  onSaveGrouping,
  onDeleteGrouping,
  labelColor = null,
  onSetLabelColor,
}: InterlinearSubModePickerProps) {
  const [dsMenuOpen,   setDsMenuOpen]   = useState(false);
  const [creating,     setCreating]     = useState(false);
  const [newName,      setNewName]      = useState("");
  const [newDirection, setNewDirection] = useState<"ltr" | "rtl">("ltr");
  const [renamingId,   setRenamingId]   = useState<number | null>(null);
  const [renameVal,    setRenameVal]    = useState("");
  const [copyOpen,     setCopyOpen]     = useState(false);
  const [copyFormat,   setCopyFormat]   = useState<"running" | "interlinear">("running");
  const [copyStart,    setCopyStart]    = useState(minVerse);
  const [copyEnd,      setCopyEnd]      = useState(maxVerse);
  const [copying,      setCopying]      = useState(false);
  const [copied,       setCopied]       = useState(false);
  const [groupPromptOpen, setGroupPromptOpen] = useState(false);
  const menuRef       = useRef<HTMLDivElement>(null);
  const copyRef       = useRef<HTMLDivElement>(null);
  const groupRef      = useRef<HTMLDivElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const groupInputRef  = useRef<HTMLInputElement>(null);

  const activeDs      = activeDatasetId(subMode);
  const currentSimple = typeof subMode === "string" ? subMode : null;
  const isTranslit    = subMode === "transliteration";
  const isConstituent = subMode === "constituent";

  const btnBase =
    "px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap";
  const btnActive =
    "bg-blue-600 text-white";
  const btnIdle =
    "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700";

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const ds = await onCreateDataset(name, newDirection);
    if (ds) {
      onChange({ type: "dataset", id: ds.id, name: ds.name });
      setNewName("");
      setNewDirection("ltr");
      setCreating(false);
    }
  }

  function handleRename(id: number) {
    const val = renameVal.trim();
    if (val) onRenameDataset(id, val);
    setRenamingId(null);
    setRenameVal("");
  }

  function openCopy() {
    setCopyStart(minVerse);
    setCopyEnd(maxVerse);
    setCopied(false);
    setCopyOpen((v) => !v);
    setDsMenuOpen(false);
  }

  async function handleCopy() {
    if (!onCopyTransliteration) return;
    setCopying(true);
    await onCopyTransliteration({
      format: copyFormat,
      startVerse: copyStart,
      endVerse: copyEnd,
    });
    setCopying(false);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const panelStyle = {
    borderColor: "var(--border)",
    backgroundColor: "var(--surface)",
  };

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
          onClick={() => { setDsMenuOpen((v) => !v); setCopyOpen(false); }}
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
            style={panelStyle}
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
                      title={ds.direction === "rtl" ? "Right-to-left — click for left-to-right" : "Left-to-right — click for right-to-left"}
                      className="text-[9px] font-semibold px-1 py-0.5 rounded hover:bg-stone-100 dark:hover:bg-stone-700 w-7 text-center"
                      style={{ color: "var(--text-muted)" }}
                      onClick={() => onSetDatasetDirection(ds.id, ds.direction === "rtl" ? "ltr" : "rtl")}
                    >{ds.direction === "rtl" ? "RTL" : "LTR"}</button>
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
                <div className="flex flex-col gap-1.5 px-2 py-1">
                  <div className="flex items-center gap-1">
                    <input
                      ref={createInputRef}
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Dataset name"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreate();
                        if (e.key === "Escape") { setCreating(false); setNewName(""); setNewDirection("ltr"); }
                      }}
                      className="flex-1 rounded border px-1.5 py-0.5 text-xs outline-none"
                      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
                    />
                    <button
                      onClick={handleCreate}
                      className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white"
                    >Add</button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Direction:</span>
                    <div className="flex gap-1">
                      {(["ltr", "rtl"] as const).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setNewDirection(d)}
                          title={d === "ltr" ? "Left-to-right (e.g. English glosses)" : "Right-to-left (e.g. Hebrew/Arabic values)"}
                          className={[
                            "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
                            newDirection === d
                              ? "bg-blue-600 border-blue-600 text-white"
                              : "border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700",
                          ].join(" ")}
                          style={{ color: newDirection === d ? undefined : "var(--foreground)" }}
                        >
                          {d === "ltr" ? "LTR" : "RTL"}
                        </button>
                      ))}
                    </div>
                  </div>
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

      {/* ── Word grouping (when a dataset or constituent labeling is active) ── */}
      {(activeDs != null || isConstituent) && (
        <>
          <button
            onClick={() => { onToggleNewGrouping?.(); setGroupPromptOpen(false); }}
            title="Toggle new-grouping mode: click words to combine them into one group"
            className={[btnBase, groupingMode === "new" ? btnActive : btnIdle].join(" ")}
          >
            New grouping
          </button>
          <button
            onClick={() => { onToggleEditGrouping?.(); setGroupPromptOpen(false); }}
            title="Toggle edit-grouping mode: click a grouped word to load and modify its group"
            className={[btnBase, groupingMode === "edit" ? btnActive : btnIdle].join(" ")}
          >
            Edit grouping
          </button>
          {groupingMode !== "off" && (
            <div className="relative" ref={groupRef}>
              <button
                onClick={() => {
                  if (pendingGroupCount === 0) return;
                  setGroupPromptOpen((v) => !v);
                  setTimeout(() => groupInputRef.current?.focus(), 0);
                }}
                disabled={pendingGroupCount === 0}
                title="Save the selected words as one grouping"
                className={[btnBase, "disabled:opacity-40 disabled:cursor-not-allowed", groupPromptOpen ? btnActive : btnIdle].join(" ")}
              >
                Save grouping{pendingGroupCount > 0 ? ` (${pendingGroupCount})` : ""}
              </button>

              {groupPromptOpen && (
                <div
                  className="absolute left-0 top-full mt-1 z-50 rounded-lg border shadow-lg p-2 flex flex-col gap-1.5"
                  style={{ ...panelStyle, minWidth: isConstituent ? "180px" : "160px", maxWidth: isConstituent ? "220px" : undefined }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {isConstituent ? (
                    <div className="flex flex-wrap gap-1">
                      {CONSTITUENT_LABELS.map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => onGroupDraftValueChange?.(groupDraftValue === key ? "" : key)}
                          title={label}
                          className={[
                            "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
                            groupDraftValue === key
                              ? "bg-blue-600 border-blue-600 text-white"
                              : "border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700",
                          ].join(" ")}
                          style={{ color: groupDraftValue === key ? undefined : "var(--foreground)" }}
                        >
                          {key}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input
                      ref={groupInputRef}
                      autoFocus
                      value={groupDraftValue}
                      onChange={(e) => onGroupDraftValueChange?.(e.target.value)}
                      placeholder="Enter value…"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { onSaveGrouping?.(); setGroupPromptOpen(false); }
                        if (e.key === "Escape") setGroupPromptOpen(false);
                      }}
                      className="rounded border px-1.5 py-0.5 text-xs outline-none w-full"
                      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
                    />
                  )}
                  {!isConstituent && groupDraftValue.trim() && (
                    <span className="flex flex-wrap items-center gap-1">
                      <button
                        onClick={() => onSetLabelColor?.(null)}
                        title="Use the automatic color for this label"
                        className="w-4 h-4 rounded-full border flex items-center justify-center text-[8px] leading-none"
                        style={{
                          borderColor: labelColor == null ? "var(--foreground)" : "var(--border)",
                          color: "var(--text-muted)",
                        }}
                      >
                        ×
                      </button>
                      {DATASET_GROUP_SWATCHES.map((c) => (
                        <button
                          key={c}
                          onClick={() => onSetLabelColor?.(c)}
                          title={c}
                          className="w-4 h-4 rounded-full transition-transform hover:scale-110"
                          style={{
                            backgroundColor: c,
                            outline: labelColor === c ? "2px solid var(--foreground)" : "none",
                            outlineOffset: "1px",
                          }}
                        />
                      ))}
                    </span>
                  )}
                  <span className="flex gap-1 justify-end">
                    {isEditingExistingGroup && (
                      <button
                        onClick={() => { onDeleteGrouping?.(); setGroupPromptOpen(false); }}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-red-300 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                      >
                        Delete group
                      </button>
                    )}
                    <button
                      onClick={() => { onSaveGrouping?.(); setGroupPromptOpen(false); }}
                      disabled={!groupDraftValue.trim()}
                      className="text-[10px] px-2 py-0.5 rounded bg-blue-600 text-white disabled:opacity-40"
                    >
                      Save
                    </button>
                  </span>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Copy transliteration (only in Translit. mode) ─────────────────── */}
      {isTranslit && onCopyTransliteration && (
        <div className="relative" ref={copyRef}>
          <button
            onClick={openCopy}
            title="Copy transliteration to clipboard"
            className={[btnBase, "flex items-center gap-1", copyOpen ? btnActive : btnIdle].join(" ")}
          >
            Copy <span className="opacity-70">▾</span>
          </button>

          {copyOpen && (
            <div
              className="absolute left-0 top-full mt-1 z-50 rounded-lg border shadow-lg p-3 flex flex-col gap-2.5"
              style={{ ...panelStyle, minWidth: "220px" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Format toggle */}
              <div>
                <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>Format</p>
                <div className="flex gap-1">
                  {(["running", "interlinear"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setCopyFormat(f)}
                      className={[
                        "flex-1 text-xs px-2 py-1 rounded border transition-colors",
                        copyFormat === f
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700",
                      ].join(" ")}
                      style={{ color: copyFormat === f ? undefined : "var(--foreground)" }}
                    >
                      {f === "running" ? "Running text" : "Interlinear table"}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
                  {copyFormat === "running"
                    ? "Flowing text per verse — good for inline citations"
                    : "Source + transliteration rows — good for interlinear display"}
                </p>
              </div>

              {/* Verse range */}
              <div>
                <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>Verses</p>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={minVerse}
                    max={maxVerse}
                    value={copyStart}
                    onChange={(e) => setCopyStart(Math.max(minVerse, Math.min(maxVerse, parseInt(e.target.value) || minVerse)))}
                    className="w-14 rounded border px-1.5 py-0.5 text-xs outline-none text-center"
                    style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
                  />
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>–</span>
                  <input
                    type="number"
                    min={minVerse}
                    max={maxVerse}
                    value={copyEnd}
                    onChange={(e) => setCopyEnd(Math.max(minVerse, Math.min(maxVerse, parseInt(e.target.value) || maxVerse)))}
                    className="w-14 rounded border px-1.5 py-0.5 text-xs outline-none text-center"
                    style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
                  />
                  <button
                    onClick={() => { setCopyStart(minVerse); setCopyEnd(maxVerse); }}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700"
                    style={{ color: "var(--text-muted)" }}
                    title="Reset to full chapter"
                  >All</button>
                </div>
              </div>

              {/* Copy button */}
              <button
                onClick={handleCopy}
                disabled={copying}
                className={[
                  "w-full text-xs px-3 py-1.5 rounded font-medium transition-colors",
                  copied
                    ? "bg-green-600 text-white"
                    : "bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60",
                ].join(" ")}
              >
                {copied ? "✓ Copied!" : copying ? "Copying…" : "Copy to clipboard"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
