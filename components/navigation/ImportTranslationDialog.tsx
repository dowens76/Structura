"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  importTranslationAction,
  importUsfmFileAction,
  checkExistingVersesAction,
} from "@/app/import/actions";
import { parseUsfmFile } from "@/lib/utils/usfm-full-parser";
import type { ParsedUsfmFile } from "@/lib/utils/usfm-full-parser";
import { OSIS_BOOKS_OT, OSIS_BOOKS_NT } from "@/lib/utils/osis";
import type { Translation } from "@/lib/db/schema";
import { useTranslation } from "@/lib/i18n/LocaleContext";

interface Props {
  /** OSIS book code for the current view — pre-populates the paste tab. */
  osisBook: string;
  /** Current chapter — pre-populates the paste tab. */
  chapter: number;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const INITIAL_PASTE = { success: false, error: null as string | null, count: 0, redirectTo: null as string | null };
const INITIAL_USFM  = { success: false, error: null as string | null, count: 0, detectedBook: null as string | null, booksImported: [] as string[], redirectTo: null as string | null };

const inputClass = "w-full px-2 py-1.5 rounded border text-sm bg-[var(--surface,white)] text-[var(--foreground)] border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-amber-400";

const BUILTIN_ABBREVIATIONS = new Set(["ULT", "VCB", "LXX"]);

// ── TranslationSelector ───────────────────────────────────────────────────────

function TranslationSelector({
  translations,
  name, setName,
  abbr, setAbbr,
}: {
  translations: Translation[];
  name: string; setName: (v: string) => void;
  abbr: string; setAbbr: (v: string) => void;
}) {
  const { t: tr } = useTranslation();
  const userTranslations = translations.filter(t => !BUILTIN_ABBREVIATIONS.has(t.abbreviation));
  const [mode, setMode] = useState<"existing" | "new">("new");
  const modeInitialized = useRef(false);
  useEffect(() => {
    if (!modeInitialized.current && userTranslations.length > 0) {
      setMode("existing");
      modeInitialized.current = true;
    }
  }, [userTranslations.length]);

  function pickExisting(t: Translation) {
    setName(t.name);
    setAbbr(t.abbreviation);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => setMode("existing")}
          disabled={userTranslations.length === 0}
          className={`px-2 py-1 rounded border transition-colors ${mode === "existing" ? "bg-amber-500 text-white border-amber-500" : "border-[var(--border)] text-[var(--foreground)]"}`}
        >
          {tr("importDialog.existing")}
        </button>
        <button
          type="button"
          onClick={() => setMode("new")}
          className={`px-2 py-1 rounded border transition-colors ${mode === "new" ? "bg-amber-500 text-white border-amber-500" : "border-[var(--border)] text-[var(--foreground)]"}`}
        >
          {tr("importDialog.new")}
        </button>
      </div>

      {mode === "existing" ? (
        <select
          className={inputClass}
          value={abbr}
          onChange={e => {
            const t = userTranslations.find(t => t.abbreviation === e.target.value);
            if (t) pickExisting(t);
          }}
        >
          <option value="">{tr("importDialog.select")}</option>
          {userTranslations.map(t => (
            <option key={t.id} value={t.abbreviation}>{t.abbreviation} — {t.name}</option>
          ))}
        </select>
      ) : (
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-xs text-[var(--text-muted)] mb-0.5">{tr("importDialog.fullName")}</label>
            <input className={inputClass} placeholder={tr("importDialog.fullNamePlaceholder")} value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="w-24">
            <label className="block text-xs text-[var(--text-muted)] mb-0.5">{tr("importDialog.abbreviation")}</label>
            <input className={inputClass} placeholder="ESV" value={abbr} onChange={e => setAbbr(e.target.value.toUpperCase().slice(0, 12))} />
          </div>
        </div>
      )}

      {/* Hidden inputs so server action can read them */}
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="abbreviation" value={abbr} />
    </div>
  );
}

// ── PasteTab ──────────────────────────────────────────────────────────────────

function PasteTab({
  osisBook, chapter, translations, onSuccess,
}: {
  osisBook: string; chapter: number;
  translations: Translation[];
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [abbr, setAbbr] = useState("");
  const [book, setBook] = useState(osisBook);
  const [ch,   setCh]   = useState(String(chapter));
  const [overwrite, setOverwrite] = useState(false);
  const [conflictCount, setConflictCount] = useState(0);

  const [state, action, pending] = useActionState(importTranslationAction, INITIAL_PASTE);
  const { t, refBookName } = useTranslation();

  useEffect(() => {
    if (state.success) onSuccess();
  }, [state.success, onSuccess]);

  async function checkConflict() {
    if (!abbr || !book || !ch) return;
    const { count } = await checkExistingVersesAction(abbr, book, parseInt(ch));
    setConflictCount(count);
    setOverwrite(count === 0);
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <TranslationSelector translations={translations} name={name} setName={setName} abbr={abbr} setAbbr={setAbbr} />

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-xs text-[var(--text-muted)] mb-0.5">{t("importDialog.book")}</label>
          <select className={inputClass} name="osisBook" value={book} onChange={e => { setBook(e.target.value); setOverwrite(false); setConflictCount(0); }}>
            <optgroup label={t("importDialog.oldTestament")}>
              {OSIS_BOOKS_OT.map(b => <option key={b} value={b}>{refBookName(b)}</option>)}
            </optgroup>
            <optgroup label={t("importDialog.newTestament")}>
              {OSIS_BOOKS_NT.map(b => <option key={b} value={b}>{refBookName(b)}</option>)}
            </optgroup>
          </select>
        </div>
        <div className="w-20">
          <label className="block text-xs text-[var(--text-muted)] mb-0.5">{t("importDialog.chapter")}</label>
          <input className={inputClass} name="chapter" type="number" min="1" value={ch} onChange={e => { setCh(e.target.value); setOverwrite(false); setConflictCount(0); }} />
        </div>
      </div>

      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-0.5">{t("importDialog.pasteText")}</label>
        <textarea
          className={`${inputClass} resize-none`}
          name="pastedText"
          rows={8}
          placeholder={t("importDialog.pastePlaceholder")}
        />
      </div>

      {conflictCount > 0 && !overwrite && (
        <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <p className="font-semibold mb-1">{t("importDialog.versesExist", { n: conflictCount })}</p>
          <button type="button" onClick={() => setOverwrite(true)} className="underline">{t("importDialog.confirmOverwrite")}</button>
        </div>
      )}

      {state.error && (
        <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>
      )}

      {overwrite || conflictCount === 0 ? (
        <button
          type="submit"
          disabled={pending || !name || !abbr}
          className="w-full py-2 rounded bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium disabled:opacity-50"
        >
          {pending ? t("importDialog.importing") : t("importDialog.import")}
        </button>
      ) : (
        <button
          type="button"
          onClick={checkConflict}
          disabled={!name || !abbr || !book || !ch}
          className="w-full py-2 rounded bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium disabled:opacity-50"
        >
          {t("importDialog.checkImport")}
        </button>
      )}
    </form>
  );
}

// ── UsfmTab ───────────────────────────────────────────────────────────────────

const KNOWN_PRESERVED: Record<string, string> = {
  nd: "\\nd  (Divine Name)", add: "\\add (Translator addition)", wj: "\\wj  (Words of Jesus)",
  f: "\\f   (Footnote)", x: "\\x   (Cross-reference)", p: "\\p   (Paragraph break)",
  m: "\\m   (Margin paragraph)", q1: "\\q1  (Poetry indent 1)", q2: "\\q2  (Poetry indent 2)",
  q3: "\\q3  (Poetry indent 3)", s1: "\\s1  (Section heading 1)", s2: "\\s2  (Section heading 2)",
};

function UsfmTab({ translations, onSuccess }: { translations: Translation[]; onSuccess: () => void }) {
  const [name, setName] = useState("");
  const [abbr, setAbbr] = useState("");
  const [parsed, setParsed] = useState<ParsedUsfmFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [state, action, pending] = useActionState(importUsfmFileAction, INITIAL_USFM);
  const { t } = useTranslation();

  useEffect(() => {
    if (state.success) onSuccess();
  }, [state.success, onSuccess]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    setParsed(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setParsed(parseUsfmFile(text));
    } catch (err) {
      setFileError(t("importDialog.parseError", { msg: String(err) }));
    }
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <TranslationSelector translations={translations} name={name} setName={setName} abbr={abbr} setAbbr={setAbbr} />

      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-0.5">{t("importDialog.usfmFile")}</label>
        <input
          ref={fileRef}
          type="file"
          name="usfmFile"
          accept=".usfm,.sfm,.SFM,.USFM,.txt"
          onChange={handleFileChange}
          className="w-full text-sm text-[var(--foreground)] file:mr-2 file:px-2 file:py-1 file:rounded file:border-0 file:text-xs file:bg-amber-500 file:text-white file:cursor-pointer"
        />
      </div>

      {fileError && <p className="text-xs text-red-600">{fileError}</p>}

      {parsed && (
        <div className="rounded border border-[var(--border)] p-3 text-xs space-y-1.5">
          <p><span className="text-[var(--text-muted)]">{t("importDialog.detectedBook")}</span> <strong>{parsed.detectedBook ?? t("importDialog.unknown")}</strong></p>
          <p><span className="text-[var(--text-muted)]">{t("importDialog.verses")}</span> {t("importDialog.versesAcross", { v: parsed.stats.verses, c: parsed.stats.chapters })}</p>
          {parsed.markerInventory.preserved.length > 0 && (
            <div>
              <p className="text-green-700 dark:text-green-400 font-semibold mt-1.5">{t("importDialog.preserved")}</p>
              <ul className="mt-0.5 space-y-0.5">
                {parsed.markerInventory.preserved.map(m => (
                  <li key={m} className="flex items-center gap-1.5">
                    <span className="text-green-600">✓</span>
                    <span className="font-mono">{KNOWN_PRESERVED[m] ?? `\\${m}`}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {parsed.markerInventory.stripped.length > 0 && (
            <div>
              <p className="text-red-600 dark:text-red-400 font-semibold mt-1.5">{t("importDialog.stripped")}</p>
              <ul className="mt-0.5 space-y-0.5">
                {parsed.markerInventory.stripped.map(m => (
                  <li key={m} className="flex items-center gap-1.5">
                    <span className="text-red-500">✕</span>
                    <span className="font-mono text-[var(--text-muted)]">\\{m}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {state.error && <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>}

      <button
        type="submit"
        disabled={pending || !name || !abbr || !parsed}
        className="w-full py-2 rounded bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium disabled:opacity-50"
      >
        {pending ? t("importDialog.importing") : t("importDialog.import")}
      </button>
    </form>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

export default function ImportTranslationDialog({ osisBook, chapter }: Props) {
  const router = useRouter();
  const { t: tr } = useTranslation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"paste" | "usfm">("paste");
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [success, setSuccess] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setSuccess(false);
    fetch("/api/translations")
      .then(r => r.json())
      .then((data: Translation[]) => setTranslations(Array.isArray(data) ? data : []))
      .catch(() => setTranslations([]));
  }, [open]);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) setOpen(false);
    }
    function keyHandler(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => { document.removeEventListener("mousedown", handler); document.removeEventListener("keydown", keyHandler); };
  }, [open]);

  function handleSuccess() {
    setSuccess(true);
    router.refresh();
    setTimeout(() => { setOpen(false); setSuccess(false); }, 1500);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs px-2 py-1 rounded transition-colors"
        style={{ color: "var(--nav-fg)" }}
      >
        {tr("nav.import")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
          <div
            ref={dialogRef}
            className="w-full max-w-md rounded-xl shadow-2xl border overflow-hidden"
            style={{ backgroundColor: "var(--background)", borderColor: "var(--border)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
              <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{tr("importDialog.title")}</h2>
              <button onClick={() => setOpen(false)} className="text-xs px-2 py-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800" style={{ color: "var(--text-muted)" }}>✕</button>
            </div>

            {success ? (
              <div className="px-4 py-8 text-center text-green-600 dark:text-green-400">
                <p className="text-2xl mb-2">✓</p>
                <p className="text-sm font-medium">{tr("importDialog.complete")}</p>
              </div>
            ) : (
              <>
                {/* Tabs */}
                <div className="flex border-b" style={{ borderColor: "var(--border)" }}>
                  {(["paste", "usfm"] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      className="flex-1 py-2 text-xs font-medium transition-colors"
                      style={{
                        color: tab === t ? "var(--accent)" : "var(--text-muted)",
                        borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
                      }}
                    >
                      {t === "paste" ? tr("importDialog.pasteText") : tr("importDialog.usfmFile")}
                    </button>
                  ))}
                </div>

                {/* Body */}
                <div className="px-4 py-4 max-h-[70vh] overflow-y-auto">
                  {tab === "paste" ? (
                    <PasteTab osisBook={osisBook} chapter={chapter} translations={translations} onSuccess={handleSuccess} />
                  ) : (
                    <UsfmTab translations={translations} onSuccess={handleSuccess} />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
