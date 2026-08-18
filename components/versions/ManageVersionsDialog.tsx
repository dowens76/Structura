"use client";

import { useRef, useEffect, useState } from "react";
import type { Version } from "@/lib/db/schema";
import { VERSIONABLE_FEATURE_LABELS, FEATURES_REQUIRING_PARAGRAPH_BREAKS } from "@/lib/versions/featureLabels";

interface Props {
  versions: Version[];
  activeVersionId: number;
  onClose: () => void;
  onChanged: () => void;
}

export default function ManageVersionsDialog({ versions, activeVersionId, onClose, onChanged }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) onClose();
    }
    function keyHandler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose]);

  const effectiveVersions = versions.length > 0 ? versions : [{ id: activeVersionId, name: "Version 1" } as Version];

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        className="rounded-lg border shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Manage versions</h2>
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
          {effectiveVersions.map((v) => (
            <VersionRowEditor
              key={v.id}
              version={v}
              allVersions={effectiveVersions}
              isOnlyVersion={effectiveVersions.length === 1}
              onChanged={onChanged}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function VersionRowEditor({
  version,
  allVersions,
  isOnlyVersion,
  onChanged,
}: {
  version: Version;
  allVersions: Version[];
  isOnlyVersion: boolean;
  onChanged: () => void;
}) {
  const [name, setName] = useState(version.name);
  const [savedName, setSavedName] = useState(version.name);
  const [saving, setSaving] = useState(false);
  const [showCopy, setShowCopy] = useState(false);
  const [copyFromId, setCopyFromId] = useState<number | null>(
    allVersions.find((v) => v.id !== version.id)?.id ?? null
  );
  const [checkedFeatures, setCheckedFeatures] = useState<Set<string>>(new Set());
  const [copying, setCopying] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dirty = name !== savedName;
  const otherVersions = allVersions.filter((v) => v.id !== version.id);

  async function handleRename() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await fetch(`/api/versions/${version.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      setSavedName(name.trim());
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  function toggleFeature(key: string) {
    setCheckedFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        // Paragraph breaks can't be unchecked while a feature that depends
        // on them (clause labels, scene breaks) is still checked — see
        // FEATURES_REQUIRING_PARAGRAPH_BREAKS.
        if (key === "paragraphBreaks" && FEATURES_REQUIRING_PARAGRAPH_BREAKS.some((k) => next.has(k))) {
          return prev;
        }
        next.delete(key);
      } else {
        next.add(key);
        if (FEATURES_REQUIRING_PARAGRAPH_BREAKS.includes(key)) next.add("paragraphBreaks");
      }
      return next;
    });
  }

  const paragraphBreaksRequired = FEATURES_REQUIRING_PARAGRAPH_BREAKS.some((k) => checkedFeatures.has(k));

  function selectAllFeatures() {
    setCheckedFeatures(new Set(VERSIONABLE_FEATURE_LABELS.map((f) => f.key)));
  }
  function selectNoFeatures() {
    setCheckedFeatures(new Set());
  }

  async function handleApplyCopy() {
    if (!copyFromId || checkedFeatures.size === 0 || copying) return;
    setCopying(true);
    try {
      await fetch(`/api/versions/${version.id}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromVersionId: copyFromId, featureKeys: Array.from(checkedFeatures) }),
      });
      setCheckedFeatures(new Set());
      setShowCopy(false);
      onChanged();
    } finally {
      setCopying(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await fetch(`/api/versions/${version.id}`, { method: "DELETE" });
      onChanged();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 min-w-0 text-sm px-2 py-1 rounded border bg-transparent"
          style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
        />
        <button
          type="button"
          onClick={handleRename}
          disabled={!dirty || saving || !name.trim()}
          className="text-xs font-semibold px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setShowCopy((v) => !v)}
          disabled={otherVersions.length === 0}
          className="text-xs px-2 py-1 rounded border transition-colors disabled:opacity-40"
          style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
        >
          Copy markup from another version…
        </button>

        {!confirmingDelete ? (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            disabled={isOnlyVersion}
            title={isOnlyVersion ? "Create another version before deleting this one" : undefined}
            className="text-xs px-2 py-1 rounded border text-red-600 dark:text-red-400 transition-colors disabled:opacity-40"
            style={{ borderColor: "var(--border)" }}
          >
            Delete
          </button>
        ) : (
          <span className="flex items-center gap-1 text-xs">
            <span style={{ color: "var(--text-muted)" }}>Delete this version?</span>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="px-2 py-0.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="px-2 py-0.5 rounded border"
              style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
            >
              Cancel
            </button>
          </span>
        )}
      </div>

      {showCopy && (
        <div className="rounded border p-2 space-y-2" style={{ borderColor: "var(--border)" }}>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Replaces this version&rsquo;s markup for the selected features — this does not merge.
          </p>
          <select
            value={copyFromId ?? ""}
            onChange={(e) => setCopyFromId(parseInt(e.target.value, 10))}
            className="w-full text-sm px-2 py-1.5 rounded border bg-transparent"
            style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
          >
            {otherVersions.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={selectAllFeatures}
              className="text-xs underline-offset-2 hover:underline"
              style={{ color: "var(--text-muted)" }}
            >
              All
            </button>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>/</span>
            <button
              type="button"
              onClick={selectNoFeatures}
              className="text-xs underline-offset-2 hover:underline"
              style={{ color: "var(--text-muted)" }}
            >
              None
            </button>
          </div>
          <div className="space-y-1">
            {VERSIONABLE_FEATURE_LABELS.map(({ key, label }) => {
              const forced = key === "paragraphBreaks" && paragraphBreaksRequired;
              return (
                <label key={key} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--foreground)" }}>
                  <input
                    type="checkbox"
                    checked={checkedFeatures.has(key)}
                    onChange={() => toggleFeature(key)}
                    disabled={forced}
                    className="accent-[var(--accent)]"
                  />
                  {label}
                  {forced && (
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      (required by clause labels / scene breaks)
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          <button
            type="button"
            onClick={handleApplyCopy}
            disabled={!copyFromId || checkedFeatures.size === 0 || copying}
            className="text-xs font-semibold px-2 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 transition-colors"
          >
            {copying ? "Applying…" : "Apply"}
          </button>
        </div>
      )}
    </div>
  );
}
