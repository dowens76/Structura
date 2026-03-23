"use client";

import { useState } from "react";
import type { RstTypeEntry } from "@/lib/morphology/clauseRelationships";
import { RELATIONSHIP_TYPES } from "@/lib/morphology/clauseRelationships";

// 20-swatch palette for colour picker
const COLOR_SWATCHES = [
  "#DC2626", "#EA580C", "#D97706", "#CA8A04", "#65A30D",
  "#16A34A", "#059669", "#0891B2", "#0284C7", "#2563EB",
  "#4F46E5", "#7C3AED", "#C026D3", "#DB2777", "#E11D48",
  "#78716C", "#475569", "#374151", "#0F766E", "#1D4ED8",
];

interface RstCustomRow {
  id: number;
  key: string;
  label: string;
  abbr: string;
  color: string;
  category: "coordinate" | "subordinate";
}

interface Props {
  customTypes: RstCustomRow[];
  onAdd:    (t: Omit<RstCustomRow, "id" | "key">) => Promise<void>;
  onUpdate: (id: number, updates: Partial<Omit<RstCustomRow, "id" | "key">>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

const BLANK: { label: string; abbr: string; color: string; category: "coordinate" | "subordinate" } = {
  label: "", abbr: "", color: COLOR_SWATCHES[0], category: "subordinate",
};

/** Inline chip preview */
function Chip({ abbr, color }: { abbr: string; color: string }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-bold font-mono text-white"
      style={{ backgroundColor: color, minWidth: "1.8rem" }}
    >
      {abbr || "···"}
    </span>
  );
}

/** Small colour swatch picker */
function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {COLOR_SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
          style={{
            backgroundColor: c,
            borderColor: value === c ? "white" : "transparent",
            outline: value === c ? `2px solid ${c}` : "none",
          }}
          title={c}
        />
      ))}
    </div>
  );
}

/** Inline add/edit form */
function TypeForm({
  initial = BLANK,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: typeof BLANK;
  submitLabel: string;
  onSubmit: (v: typeof BLANK) => void;
  onCancel?: () => void;
}) {
  const [val, setVal] = useState(initial);

  function set(k: keyof typeof BLANK, v: string) {
    setVal((prev) => ({ ...prev, [k]: v }));
  }

  return (
    <div className="space-y-2 text-xs">
      {/* Name + Abbr row */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Name"
          value={val.label}
          onChange={(e) => set("label", e.target.value)}
          className="flex-1 px-2 py-1 rounded border text-xs"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
        />
        <input
          type="text"
          placeholder="Abbr"
          value={val.abbr}
          maxLength={4}
          onChange={(e) => set("abbr", e.target.value.toUpperCase())}
          className="w-14 px-2 py-1 rounded border text-xs font-mono"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
        />
      </div>

      {/* Category */}
      <div className="flex gap-2 items-center">
        <span className="text-stone-400 dark:text-stone-500 shrink-0">Type:</span>
        {(["coordinate", "subordinate"] as const).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => set("category", cat)}
            className={[
              "px-2 py-0.5 rounded text-[11px] transition-colors",
              val.category === cat
                ? "bg-stone-700 text-white dark:bg-stone-300 dark:text-stone-900"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >
            {cat === "coordinate" ? "Coordinate" : "Subordinate"}
          </button>
        ))}
      </div>

      {/* Color + preview */}
      <div className="space-y-1.5">
        <ColorPicker value={val.color} onChange={(c) => set("color", c)} />
        <div className="flex items-center gap-2">
          <Chip abbr={val.abbr} color={val.color} />
          <span className="text-stone-400 dark:text-stone-500">{val.label || "—"}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={!val.label.trim() || !val.abbr.trim()}
          onClick={() => {
            if (!val.label.trim() || !val.abbr.trim()) return;
            onSubmit(val);
          }}
          className="px-3 py-1 rounded text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 disabled:pointer-events-none transition-colors"
        >
          {submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1 rounded text-xs bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export default function RstTypeManager({ customTypes, onAdd, onUpdate, onDelete }: Props) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const coordBuiltIns  = RELATIONSHIP_TYPES.filter((t) => t.category === "coordinate");
  const subordBuiltIns = RELATIONSHIP_TYPES.filter((t) => t.category === "subordinate");
  const coordCustom    = customTypes.filter((t) => t.category === "coordinate");
  const subordCustom   = customTypes.filter((t) => t.category === "subordinate");

  return (
    <div
      className="border-b border-[var(--border)] px-4 py-3 text-xs"
      style={{ backgroundColor: "var(--nav-bg)", color: "var(--nav-fg)" }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-[11px] tracking-wide uppercase" style={{ color: "var(--nav-fg-muted)" }}>
          RST Labels
        </span>
      </div>

      {/* ── Built-in types (read-only) ─────────────────────────────── */}
      <div className="mb-3">
        <p className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: "var(--nav-fg-muted)" }}>
          Built-in
        </p>
        <div className="flex flex-wrap gap-1.5">
          {RELATIONSHIP_TYPES.map((t) => (
            <span
              key={t.key}
              title={t.label}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono opacity-70"
              style={{ backgroundColor: t.color + "33", color: t.color }}
            >
              <span className="font-bold">{t.abbr}</span>
              <span className="opacity-75">{t.label}</span>
            </span>
          ))}
        </div>
      </div>

      {/* ── Custom types ───────────────────────────────────────────── */}
      {customTypes.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: "var(--nav-fg-muted)" }}>
            Custom
          </p>
          <div className="space-y-1">
            {customTypes.map((t) =>
              editingId === t.id ? (
                <div key={t.id} className="rounded p-2" style={{ backgroundColor: "rgba(255,255,255,0.05)" }}>
                  <TypeForm
                    initial={{ label: t.label, abbr: t.abbr, color: t.color, category: t.category }}
                    submitLabel="Save"
                    onSubmit={async (v) => {
                      await onUpdate(t.id, v);
                      setEditingId(null);
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              ) : (
                <div key={t.id} className="flex items-center gap-2 group">
                  <Chip abbr={t.abbr} color={t.color} />
                  <span className="flex-1" style={{ color: "var(--nav-fg)" }}>{t.label}</span>
                  <span className="text-[10px] opacity-40">{t.category === "coordinate" ? "coord." : "subord."}</span>
                  <button
                    type="button"
                    onClick={() => setEditingId(t.id)}
                    className="opacity-0 group-hover:opacity-100 text-[10px] px-1.5 py-0.5 rounded hover:bg-white/10 transition-all"
                    title="Edit"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(t.id)}
                    className="opacity-0 group-hover:opacity-100 text-[10px] px-1.5 py-0.5 rounded hover:bg-red-500/30 transition-all"
                    title="Delete"
                    style={{ color: "#f87171" }}
                  >
                    ×
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* ── Add new ────────────────────────────────────────────────── */}
      {showAdd ? (
        <div className="rounded p-2" style={{ backgroundColor: "rgba(255,255,255,0.05)" }}>
          <p className="text-[10px] uppercase tracking-wide mb-2" style={{ color: "var(--nav-fg-muted)" }}>
            New label
          </p>
          <TypeForm
            submitLabel="Add"
            onSubmit={async (v) => {
              await onAdd(v);
              setShowAdd(false);
            }}
            onCancel={() => setShowAdd(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setShowAdd(true); setEditingId(null); }}
          className="text-[11px] px-2.5 py-1 rounded transition-colors"
          style={{
            backgroundColor: "rgba(200,155,60,0.18)",
            color: "var(--accent)",
          }}
        >
          + New label
        </button>
      )}
    </div>
  );
}
