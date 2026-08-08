"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Version } from "@/lib/db/schema";
import CreateVersionDialog from "./CreateVersionDialog";
import ManageVersionsDialog from "./ManageVersionsDialog";

export interface ChapterLocus {
  book: string;
  chapter: number;
}

interface Props {
  workspaceId: number;
  /** The chapter(s) this selector applies to. Single-chapter view passes one
   *  entry; the Passage view passes every chapter it spans — the first entry
   *  is the "representative" locus the dropdown lists/selects against, while
   *  Create/Manage fan out across all of them. */
  chapters: ChapterLocus[];
  initialVersions: Version[];
  initialActiveVersionId: number;
}

export default function VersionSelector({ workspaceId, chapters, initialVersions, initialActiveVersionId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Version[]>(initialVersions);
  const [activeVersionId, setActiveVersionIdState] = useState(initialActiveVersionId);
  const [showCreate, setShowCreate] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const locus = chapters[0];

  const refetch = useCallback(() => {
    fetch(`/api/versions?book=${encodeURIComponent(locus.book)}&chapter=${locus.chapter}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.versions)) setVersions(data.versions);
        if (typeof data.activeVersionId === "number") setActiveVersionIdState(data.activeVersionId);
      })
      .catch(() => {});
  }, [locus.book, locus.chapter]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function selectVersion(id: number) {
    setOpen(false);
    setActiveVersionIdState(id);
    await fetch("/api/versions/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ book: locus.book, chapter: locus.chapter, versionId: id }),
    });
    router.refresh();
  }

  function handleChanged() {
    refetch();
    router.refresh();
  }

  const active = versions.find((v) => v.id === activeVersionId);
  const label = active?.name ?? "Version 1";

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors"
        style={{ color: "var(--nav-fg)", backgroundColor: open ? "var(--surface)" : "transparent" }}
        title="Switch version"
      >
        <span className="max-w-[100px] truncate">{label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-56 rounded-lg shadow-lg z-50 py-1"
          style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            Versions
          </div>

          {versions.length === 0 && (
            <div className="px-3 py-1.5 text-sm" style={{ color: "var(--text-muted)" }}>Version 1</div>
          )}

          {versions.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => selectVersion(v.id)}
              className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
              style={{ color: "var(--foreground)" }}
            >
              {v.id === activeVersionId ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="shrink-0">
                  <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : (
                <span className="w-3 shrink-0" />
              )}
              <span className="truncate">{v.name}</span>
            </button>
          ))}

          <div className="border-t mt-1 pt-1" style={{ borderColor: "var(--border)" }}>
            <button
              type="button"
              onClick={() => { setOpen(false); setShowCreate(true); }}
              className="w-full text-left block px-3 py-1.5 text-sm hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              + Create new version
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setShowManage(true); }}
              className="w-full text-left block px-3 py-1.5 text-sm hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              Manage versions
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <CreateVersionDialog
          workspaceId={workspaceId}
          chapters={chapters}
          existingVersions={versions}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); handleChanged(); }}
        />
      )}

      {showManage && (
        <ManageVersionsDialog
          versions={versions}
          activeVersionId={activeVersionId}
          onClose={() => setShowManage(false)}
          onChanged={handleChanged}
        />
      )}
    </div>
  );
}
