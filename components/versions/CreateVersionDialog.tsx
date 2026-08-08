"use client";

import { useEffect, useRef, useState } from "react";
import type { Version } from "@/lib/db/schema";
import { VERSIONABLE_FEATURE_LABELS, FEATURES_REQUIRING_PARAGRAPH_BREAKS } from "@/lib/versions/featureLabels";
import type { ChapterLocus } from "./VersionSelector";

interface Props {
  workspaceId: number;
  chapters: ChapterLocus[];
  existingVersions: Version[];
  onClose: () => void;
  onCreated: () => void;
}

function nextAutoName(existing: Version[]): string {
  let max = 0;
  for (const v of existing) {
    const m = /^Version (\d+)$/.exec(v.name);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Version ${max + 1}`;
}

export default function CreateVersionDialog({ chapters, existingVersions, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [sourceVersionId, setSourceVersionId] = useState<number | null>(existingVersions[0]?.id ?? null);
  const [checkedFeatures, setCheckedFeatures] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const locus = chapters[0];
  const placeholder = nextAutoName(existingVersions);

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

  async function handleCreate() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const copySpecs = sourceVersionId
        ? Array.from(checkedFeatures).map((featureKey) => ({ featureKey, fromVersionId: sourceVersionId }))
        : [];
      const res = await fetch("/api/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book: locus.book,
          chapter: locus.chapter,
          name: name.trim() || null,
          chapters: chapters.length > 1 ? chapters : undefined,
          copySpecs,
        }),
      });
      if (!res.ok) throw new Error("Failed to create version");
      onCreated();
    } catch {
      setError("Could not create the version. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-xl shadow-2xl border overflow-hidden"
        style={{ backgroundColor: "var(--background)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Create new version</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-2 py-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800"
            style={{ color: "var(--text-muted)" }}
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-4 max-h-[70vh] overflow-y-auto space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={placeholder}
              className="w-full text-sm px-2 py-1.5 rounded border bg-transparent"
              style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
            />
          </div>

          {existingVersions.length > 0 && (
            <div className="space-y-2">
              <label className="block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                Copy markup from an existing version
              </label>
              {existingVersions.length > 1 && (
                <select
                  value={sourceVersionId ?? ""}
                  onChange={(e) => setSourceVersionId(parseInt(e.target.value, 10))}
                  className="w-full text-sm px-2 py-1.5 rounded border bg-transparent"
                  style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
                >
                  {existingVersions.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              )}
              {existingVersions.length === 1 && (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Copying from &ldquo;{existingVersions[0].name}&rdquo;
                </p>
              )}

              <div className="space-y-1 pt-1">
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
            </div>
          )}

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleCreate}
              disabled={submitting}
              className="flex-1 py-2 rounded bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 py-2 rounded border text-sm font-medium transition-colors"
              style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
