"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageShell from "@/components/ui/PageShell";
import SectionHeading from "@/components/ui/SectionHeading";
import Button from "@/components/ui/Button";
import DefineSynopticSetDialog from "@/components/synoptic/DefineSynopticSetDialog";
import { OSIS_BOOK_NAMES } from "@/lib/utils/osis";
import type { SynopticSetWithColumns } from "@/lib/db/queries";

const CORPUS_SECTIONS: { key: string; label: string }[] = [
  { key: "gospels",    label: "Gospels" },
  { key: "historical", label: "Historical (Kings / Chronicles)" },
  { key: "psalms",     label: "Psalms" },
  { key: "custom",     label: "Custom" },
];

function refText(col: SynopticSetWithColumns["columns"][number]): string {
  const bookName = OSIS_BOOK_NAMES[col.book] ?? col.book;
  return col.startChapter === col.endChapter
    ? col.startVerse === col.endVerse
      ? `${bookName} ${col.startChapter}:${col.startVerse}`
      : `${bookName} ${col.startChapter}:${col.startVerse}–${col.endVerse}`
    : `${bookName} ${col.startChapter}:${col.startVerse}–${col.endChapter}:${col.endVerse}`;
}

export default function SynopticSetsPanel() {
  const router = useRouter();
  const [sets, setSets] = useState<SynopticSetWithColumns[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingSet, setEditingSet] = useState<SynopticSetWithColumns | null>(null);

  useEffect(() => {
    fetch("/api/synoptic-sets")
      .then((r) => r.json())
      .then((d: { sets?: SynopticSetWithColumns[] }) => setSets(d.sets ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: number) {
    if (!confirm("Delete this synoptic set? The underlying passages and any annotations you've made stay intact.")) return;
    await fetch(`/api/synoptic-sets/${id}`, { method: "DELETE" });
    setSets((prev) => prev.filter((s) => s.id !== id));
  }

  function handleSaved(set: SynopticSetWithColumns) {
    setSets((prev) => {
      const exists = prev.some((s) => s.id === set.id);
      return exists ? prev.map((s) => (s.id === set.id ? set : s)) : [...prev, set];
    });
  }

  return (
    <PageShell
      title="Synoptic View"
      subtitle="Compare parallel accounts — Gospel pericopes, Kings/Chronicles, Psalm 18 / 2 Samuel 22 — side by side, with full editing and a Synoptic-comparison annotation tool."
    >
      {loading ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</p>
      ) : (
        <div className="space-y-8">
          {CORPUS_SECTIONS.map(({ key, label }) => {
            const inSection = sets.filter((s) => s.corpus === key);
            if (inSection.length === 0) return null;
            return (
              <div key={key}>
                <SectionHeading size="label" className="mb-2">{label}</SectionHeading>
                <div className="space-y-2">
                  {inSection.map((set) => (
                    <div
                      key={set.id}
                      onClick={() => router.push(`/synoptic/${set.id}`)}
                      className="rounded-lg border px-4 py-3 flex items-start gap-3 cursor-pointer transition-colors hover:opacity-90"
                      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{set.title}</p>
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                            style={{
                              backgroundColor: set.source === "seed" ? "rgba(59,130,246,0.15)" : "rgba(150,150,150,0.15)",
                              color: set.source === "seed" ? "#3b82f6" : "var(--text-muted)",
                            }}
                          >
                            {set.source === "seed" ? "Built-in" : "Custom"}
                          </span>
                        </div>
                        <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
                          {set.columns.map((c) => `${c.columnLabel ?? c.label} (${refText(c)})`).join(" · ")}
                        </p>
                      </div>
                      <div className="shrink-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setEditingSet(set)}
                          className="text-xs px-2 py-1 rounded transition-colors hover:opacity-80"
                          style={{ color: "var(--text-muted)" }}
                        >
                          Edit scope
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(set.id)}
                          className="text-xs px-2 py-1 rounded transition-colors hover:text-red-500"
                          style={{ color: "var(--text-muted)" }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {sets.length === 0 && (
            <div className="text-center py-8" style={{ color: "var(--text-muted)" }}>
              <p className="text-sm mb-4">No synoptic sets yet.</p>
            </div>
          )}

          <div className="pt-2">
            <Button onClick={() => setShowCreate(true)}>+ New Synoptic Set</Button>
          </div>
        </div>
      )}

      {showCreate && (
        <DefineSynopticSetDialog
          onClose={() => setShowCreate(false)}
          onSaved={handleSaved}
        />
      )}
      {editingSet && (
        <DefineSynopticSetDialog
          existingSet={editingSet}
          onClose={() => setEditingSet(null)}
          onSaved={handleSaved}
        />
      )}
    </PageShell>
  );
}
