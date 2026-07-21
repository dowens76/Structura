"use client";

import { useState, useEffect } from "react";
import HomeLink from "@/components/ui/HomeLink";

interface TranslationRow {
  id: number;
  name: string;
  abbreviation: string;
  language: string | null;
}

const LANGUAGES: { code: string; label: string }[] = [
  { code: "", label: "— unset —" },
  { code: "af", label: "Afrikaans" },
  { code: "sq", label: "Albanian" },
  { code: "am", label: "Amharic" },
  { code: "ar", label: "Arabic" },
  { code: "hy", label: "Armenian" },
  { code: "az", label: "Azerbaijani" },
  { code: "eu", label: "Basque" },
  { code: "be", label: "Belarusian" },
  { code: "bn", label: "Bengali" },
  { code: "bs", label: "Bosnian" },
  { code: "bg", label: "Bulgarian" },
  { code: "ca", label: "Catalan" },
  { code: "zh", label: "Chinese" },
  { code: "hr", label: "Croatian" },
  { code: "cs", label: "Czech" },
  { code: "da", label: "Danish" },
  { code: "nl", label: "Dutch" },
  { code: "en", label: "English" },
  { code: "eo", label: "Esperanto" },
  { code: "et", label: "Estonian" },
  { code: "fi", label: "Finnish" },
  { code: "fr", label: "French" },
  { code: "ka", label: "Georgian" },
  { code: "de", label: "German" },
  { code: "el", label: "Greek" },
  { code: "gu", label: "Gujarati" },
  { code: "he", label: "Hebrew" },
  { code: "hi", label: "Hindi" },
  { code: "hu", label: "Hungarian" },
  { code: "id", label: "Indonesian" },
  { code: "ga", label: "Irish" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "kn", label: "Kannada" },
  { code: "kk", label: "Kazakh" },
  { code: "ko", label: "Korean" },
  { code: "lv", label: "Latvian" },
  { code: "lt", label: "Lithuanian" },
  { code: "mk", label: "Macedonian" },
  { code: "ms", label: "Malay" },
  { code: "ml", label: "Malayalam" },
  { code: "mt", label: "Maltese" },
  { code: "mr", label: "Marathi" },
  { code: "mn", label: "Mongolian" },
  { code: "ne", label: "Nepali" },
  { code: "no", label: "Norwegian" },
  { code: "fa", label: "Persian" },
  { code: "pl", label: "Polish" },
  { code: "pt", label: "Portuguese" },
  { code: "pa", label: "Punjabi" },
  { code: "ro", label: "Romanian" },
  { code: "ru", label: "Russian" },
  { code: "sr", label: "Serbian" },
  { code: "si", label: "Sinhala" },
  { code: "sk", label: "Slovak" },
  { code: "sl", label: "Slovenian" },
  { code: "so", label: "Somali" },
  { code: "es", label: "Spanish" },
  { code: "sw", label: "Swahili" },
  { code: "sv", label: "Swedish" },
  { code: "tl", label: "Tagalog" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "th", label: "Thai" },
  { code: "tr", label: "Turkish" },
  { code: "uk", label: "Ukrainian" },
  { code: "ur", label: "Urdu" },
  { code: "uz", label: "Uzbek" },
  { code: "vi", label: "Vietnamese" },
  { code: "cy", label: "Welsh" },
  { code: "xh", label: "Xhosa" },
  { code: "zu", label: "Zulu" },
];

export default function TranslationsPanel() {
  const [rows, setRows] = useState<TranslationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAbbr, setNewAbbr] = useState("");
  const [newLang, setNewLang] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/translations")
      .then((r) => r.json())
      .then((data: TranslationRow[]) => { setRows(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function patchField(id: number, patch: Partial<Pick<TranslationRow, "name" | "abbreviation" | "language">>) {
    setSaving(id);
    const res = await fetch("/api/translations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    if (res.ok) {
      setRows((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
    } else {
      const { error: msg } = await res.json();
      setError(msg ?? "Failed to update translation.");
    }
    setSaving(null);
  }

  async function handleDelete(id: number) {
    setDeleting(true);
    await fetch(`/api/translations?id=${id}`, { method: "DELETE" });
    setRows((prev) => prev.filter((r) => r.id !== id));
    setConfirmDeleteId(null);
    setDeleting(false);
  }

  async function handleCreate() {
    const name = newName.trim();
    const abbreviation = newAbbr.trim().toUpperCase();
    if (!name || !abbreviation) { setError("Name and abbreviation are required."); return; }
    setError(null);
    setCreating(true);
    const res = await fetch("/api/translations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, abbreviation, language: newLang || null }),
    });
    if (!res.ok) {
      const { error: msg } = await res.json();
      setError(msg ?? "Failed to create translation.");
    } else {
      const { id } = await res.json();
      setRows((prev) => [...prev, { id, name, abbreviation, language: newLang || null }]);
      setNewName(""); setNewAbbr(""); setNewLang("");
    }
    setCreating(false);
  }

  const inputCls = "w-full text-sm px-2 py-1 rounded border border-stone-300 dark:border-stone-600 bg-stone-50 dark:bg-stone-900 focus:outline-none focus:ring-1 focus:ring-sky-500";
  const labelCls = "text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-0.5 block";

  return (
    <div className="space-y-6">
      <div>
        <HomeLink className="mb-4" />
        <h1 className="text-2xl font-semibold mb-1" style={{ color: "var(--foreground)" }}>
          Manage Translations
        </h1>
      </div>

      <div className="space-y-4">
        {loading && <p className="text-sm text-stone-400">Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-stone-400 dark:text-stone-500">No translations yet. Create one below.</p>
        )}
        {rows.map((row) => (
          <TranslationEditor
            key={row.id}
            row={row}
            saving={saving === row.id}
            onSave={(patch) => patchField(row.id, patch)}
            confirmingDelete={confirmDeleteId === row.id}
            deleting={deleting && confirmDeleteId === row.id}
            onRequestDelete={() => setConfirmDeleteId(row.id)}
            onCancelDelete={() => setConfirmDeleteId(null)}
            onConfirmDelete={() => handleDelete(row.id)}
          />
        ))}
      </div>

      {/* Create new */}
      <div className="border-t pt-4 space-y-3" style={{ borderColor: "var(--border)" }}>
        <p className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">New Translation</p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Name</label>
            <input
              className={inputCls}
              placeholder="e.g. My Translation"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            />
          </div>
          <div>
            <label className={labelCls}>Abbreviation</label>
            <input
              className={inputCls}
              placeholder="e.g. MT"
              maxLength={12}
              value={newAbbr}
              onChange={(e) => setNewAbbr(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            />
          </div>
          <div>
            <label className={labelCls}>Language</label>
            <select
              className={inputCls}
              value={newLang}
              onChange={(e) => setNewLang(e.target.value)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button
          onClick={handleCreate}
          disabled={creating}
          className="px-4 py-1.5 rounded text-sm font-medium bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-40 transition-colors"
        >
          {creating ? "Creating…" : "+ Create Translation"}
        </button>
      </div>
    </div>
  );
}

function TranslationEditor({
  row,
  saving,
  onSave,
  confirmingDelete,
  deleting,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  row: TranslationRow;
  saving: boolean;
  onSave: (patch: Partial<Pick<TranslationRow, "name" | "abbreviation" | "language">>) => void;
  confirmingDelete: boolean;
  deleting: boolean;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [abbr, setAbbr] = useState(row.abbreviation);
  const [lang, setLang] = useState(row.language ?? "");

  const inputCls = "w-full text-sm px-2 py-1 rounded border border-stone-300 dark:border-stone-600 bg-stone-50 dark:bg-stone-900 focus:outline-none focus:ring-1 focus:ring-sky-500";
  const labelCls = "text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-0.5 block";

  return (
    <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: confirmingDelete ? "var(--color-pos-verb)" : "var(--border)" }}>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Name</label>
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { if (name.trim() && name.trim() !== row.name) onSave({ name: name.trim() }); }}
          />
        </div>
        <div>
          <label className={labelCls}>Abbreviation</label>
          <input
            className={inputCls}
            value={abbr}
            maxLength={12}
            onChange={(e) => setAbbr(e.target.value.toUpperCase())}
            onBlur={() => { if (abbr.trim() && abbr.trim() !== row.abbreviation) onSave({ abbreviation: abbr.trim() }); }}
          />
        </div>
        <div>
          <label className={labelCls}>Language</label>
          <select
            className={inputCls}
            value={lang}
            onChange={(e) => { setLang(e.target.value); onSave({ language: e.target.value || null }); }}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          {saving && <p className="text-[10px] text-stone-400">Saving…</p>}
        </div>
        {!confirmingDelete ? (
          <button
            onClick={onRequestDelete}
            className="text-[11px] text-stone-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
          >
            Remove
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-red-500 dark:text-red-400">
              Delete &quot;{row.name}&quot; and all its verses?
            </span>
            <button
              onClick={onCancelDelete}
              className="text-[11px] px-2 py-0.5 rounded border border-stone-300 dark:border-stone-600 text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirmDelete}
              disabled={deleting}
              className="text-[11px] px-2 py-0.5 rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 transition-colors"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
