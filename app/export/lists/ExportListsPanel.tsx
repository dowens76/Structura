"use client";

import { useEffect, useState } from "react";

interface TagGroup {
  name: string;
  type: string;
  books: string[];
  color: string;
  count: number;
}

interface CharGroup {
  name: string;
  books: string[];
  color: string;
  count: number;
}

interface Translation {
  id: number;
  abbreviation: string;
  name: string;
}

interface BookInfo {
  osisCode: string;
  name: string;
  bookNumber: number;
  testament: string;
}

interface ListsData {
  wordTagGroups: TagGroup[];
  characterGroups: CharGroup[];
  translations: Translation[];
  books: BookInfo[];
}

export default function ExportListsPanel() {
  const [data, setData] = useState<ListsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selections
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [selectedChars, setSelectedChars] = useState<Set<string>>(new Set());
  const [selectedBooks, setSelectedBooks] = useState<Set<string>>(new Set());

  // Export state
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/export/tag-lists")
      .then((r) => r.json())
      .then((d: ListsData) => {
        setData(d);
        // Default: all books selected
        setSelectedBooks(new Set(d.books.map((b) => b.osisCode)));
      })
      .catch(() => setError("Failed to load data"))
      .finally(() => setLoading(false));
  }, []);

  function toggleTag(name: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function toggleChar(name: string) {
    setSelectedChars((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function toggleBook(osisCode: string) {
    setSelectedBooks((prev) => {
      const next = new Set(prev);
      if (next.has(osisCode)) next.delete(osisCode); else next.add(osisCode);
      return next;
    });
  }

  function selectAllTags() {
    if (!data) return;
    setSelectedTags(new Set(data.wordTagGroups.map((t) => t.name)));
  }
  function clearTags() { setSelectedTags(new Set()); }
  function selectAllChars() {
    if (!data) return;
    setSelectedChars(new Set(data.characterGroups.map((c) => c.name)));
  }
  function clearChars() { setSelectedChars(new Set()); }

  async function handleExport() {
    if (!data) return;
    const items: { name: string; type: "wordTag" | "character" }[] = [
      ...Array.from(selectedTags).map((name) => ({ name, type: "wordTag" as const })),
      ...Array.from(selectedChars).map((name) => ({ name, type: "character" as const })),
    ];
    if (items.length === 0) return;

    // Pass empty array (= no filter) when all books are selected
    const allSelected = data.books.every((b) => selectedBooks.has(b.osisCode));
    const bookFilter = allSelected ? [] : Array.from(selectedBooks);
    setExporting(true);
    setExportStatus(`Exporting ${items.length} file${items.length > 1 ? "s" : ""}…`);

    let successCount = 0;
    let failCount = 0;

    for (const item of items) {
      try {
        const res = await fetch("/api/export/tag-lists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: item.name, type: item.type, bookFilter }),
        });
        if (!res.ok) {
          failCount++;
          continue;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `List-${item.name.replace(/[^\w\- ]/g, "_")}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        successCount++;
      } catch {
        failCount++;
      }
    }

    setExporting(false);
    if (failCount === 0) {
      setExportStatus(`Exported ${successCount} file${successCount > 1 ? "s" : ""} successfully.`);
    } else {
      setExportStatus(`${successCount} exported, ${failCount} failed.`);
    }
  }

  const totalSelected = selectedTags.size + selectedChars.size;

  if (loading) {
    return (
      <div className="text-sm" style={{ color: "var(--text-muted)" }}>
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-red-500">{error}</div>
    );
  }

  if (!data) return null;

  const hasAny = data.wordTagGroups.length > 0 || data.characterGroups.length > 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <button
          onClick={() => history.back()}
          className="flex items-center gap-1.5 mb-4 text-sm transition-colors hover:opacity-70"
          style={{ color: "var(--text-muted)" }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <h1 className="text-2xl font-semibold mb-1" style={{ color: "var(--foreground)" }}>
          Export Reference Lists
        </h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Export tagged words, concepts, or characters as CSV files. Each selected tag or character
          becomes a separate file named <code className="font-mono text-xs">List-[name].csv</code> with
          columns for Scripture reference, source text, and any imported translations.
        </p>
      </div>

      {!hasAny && (
        <div
          className="rounded-lg border px-4 py-6 text-center text-sm"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          No word tags or characters found in this workspace.
          Tag some words in the text view first.
        </div>
      )}

      {/* Word / Concept Tags */}
      {data.wordTagGroups.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
              Word &amp; Concept Tags
            </h2>
            <div className="flex gap-2">
              <button
                onClick={selectAllTags}
                className="text-xs px-2 py-0.5 rounded transition-colors"
                style={{ color: "var(--text-muted)" }}
              >
                Select all
              </button>
              <button
                onClick={clearTags}
                className="text-xs px-2 py-0.5 rounded transition-colors"
                style={{ color: "var(--text-muted)" }}
              >
                Clear
              </button>
            </div>
          </div>
          <div
            className="rounded-lg border divide-y overflow-hidden"
            style={{ borderColor: "var(--border)" }}
          >
            {data.wordTagGroups.map((tag) => (
              <TagRow
                key={tag.name}
                name={tag.name}
                color={tag.color}
                subtitle={`${tag.type} · ${tag.books.join(", ")} · ${tag.count} ref${tag.count !== 1 ? "s" : ""}`}
                checked={selectedTags.has(tag.name)}
                onToggle={() => toggleTag(tag.name)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Characters */}
      {data.characterGroups.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
              Characters
            </h2>
            <div className="flex gap-2">
              <button
                onClick={selectAllChars}
                className="text-xs px-2 py-0.5 rounded transition-colors"
                style={{ color: "var(--text-muted)" }}
              >
                Select all
              </button>
              <button
                onClick={clearChars}
                className="text-xs px-2 py-0.5 rounded transition-colors"
                style={{ color: "var(--text-muted)" }}
              >
                Clear
              </button>
            </div>
          </div>
          <div
            className="rounded-lg border divide-y overflow-hidden"
            style={{ borderColor: "var(--border)" }}
          >
            {data.characterGroups.map((char) => (
              <TagRow
                key={char.name}
                name={char.name}
                color={char.color}
                subtitle={`${char.books.join(", ")} · ${char.count} ref${char.count !== 1 ? "s" : ""}`}
                checked={selectedChars.has(char.name)}
                onToggle={() => toggleChar(char.name)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Book filter */}
      {hasAny && (
        <section>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
              Book Filter
            </h2>
            <button
              onClick={() => setSelectedBooks(new Set(data.books.map((b) => b.osisCode)))}
              className="text-xs px-2 py-0.5 rounded transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              All
            </button>
            <button
              onClick={() => setSelectedBooks(new Set())}
              className="text-xs px-2 py-0.5 rounded transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              None
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.books.map((b) => (
              <button
                key={b.osisCode}
                onClick={() => toggleBook(b.osisCode)}
                className="text-xs px-2 py-0.5 rounded border transition-colors"
                style={{
                  borderColor: selectedBooks.has(b.osisCode) ? "#059669" : "var(--border)",
                  backgroundColor: selectedBooks.has(b.osisCode) ? "rgba(5,150,105,0.12)" : "var(--surface-muted)",
                  color: selectedBooks.has(b.osisCode) ? "#059669" : "var(--text-muted)",
                  fontWeight: selectedBooks.has(b.osisCode) ? 600 : 400,
                }}
              >
                {b.osisCode}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Translations note */}
      {data.translations.length > 0 && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          The CSV will include {data.translations.length} translation column{data.translations.length > 1 ? "s" : ""}:{" "}
          {data.translations.map((t) => t.abbreviation).join(", ")}.
        </p>
      )}

      {/* Export button */}
      {hasAny && (
        <div className="flex items-center gap-4">
          <button
            onClick={handleExport}
            disabled={exporting || totalSelected === 0}
            className="px-4 py-2 rounded font-medium text-sm transition-colors"
            style={{
              backgroundColor: totalSelected > 0 && !exporting ? "#059669" : "var(--surface-muted)",
              color: totalSelected > 0 && !exporting ? "white" : "var(--text-muted)",
              cursor: totalSelected > 0 && !exporting ? "pointer" : "not-allowed",
            }}
          >
            {exporting
              ? "Exporting…"
              : totalSelected === 0
              ? "Select items to export"
              : `Export ${totalSelected} CSV file${totalSelected > 1 ? "s" : ""}`}
          </button>
          {exportStatus && (
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>
              {exportStatus}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Row component ─────────────────────────────────────────────────────────────

function TagRow({
  name,
  color,
  subtitle,
  checked,
  onToggle,
}: {
  name: string;
  color: string;
  subtitle: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-[var(--surface-muted)]"
      style={{ backgroundColor: "var(--surface)" }}
    >
      {/* Checkbox */}
      <span
        className="flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center"
        style={{
          borderColor: checked ? "#059669" : "var(--border-muted)",
          backgroundColor: checked ? "#059669" : "transparent",
        }}
      >
        {checked && (
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
      <input type="checkbox" checked={checked} onChange={onToggle} className="sr-only" />
      {/* Color swatch */}
      <span
        className="flex-shrink-0 w-3 h-3 rounded-full"
        style={{ backgroundColor: color }}
      />
      {/* Name + subtitle */}
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{name}</span>
        <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>{subtitle}</span>
      </div>
    </label>
  );
}
