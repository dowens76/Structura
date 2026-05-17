"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { importTranslationAction, checkExistingVersesAction, importUsfmFileAction } from "./actions";
import type { Book, Translation } from "@/lib/db/schema";
import { OSIS_BOOKS_OT, OSIS_BOOKS_NT } from "@/lib/utils/osis";
import { useTranslation } from "@/lib/i18n/LocaleContext";
import { parseUsfmFile } from "@/lib/utils/usfm-full-parser";
import type { ParsedUsfmFile } from "@/lib/utils/usfm-full-parser";

interface ImportFormProps {
  books: Book[];
  existingTranslations: Translation[];
}

const INITIAL_STATE = {
  success: false,
  error: null as string | null,
  count: 0,
  redirectTo: null as string | null,
};

const INITIAL_USFM_STATE = {
  success: false,
  error: null as string | null,
  count: 0,
  detectedBook: null as string | null,
  booksImported: [] as string[],
  redirectTo: null as string | null,
};

const inputClass =
  "w-full px-3 py-2 rounded-lg border text-sm bg-[var(--surface)] text-[var(--foreground)] border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-blue-500";

// ── Marker inventory display ──────────────────────────────────────────────────

const KNOWN_PRESERVED = new Set(["nd", "add", "wj", "f", "x", "p", "m", "q1", "q2", "q3", "s1", "s2"]);
const MARKER_LABELS: Record<string, string> = {
  nd:  "\\nd  (Divine Name → small caps)",
  add: "\\add (Translator addition → italic)",
  wj:  "\\wj  (Words of Jesus → red)",
  f:   "\\f   (Footnote → interlinear note)",
  x:   "\\x   (Cross-reference → interlinear note)",
  p:   "\\p   (Paragraph break)",
  m:   "\\m   (Margin paragraph → paragraph break)",
  q1:  "\\q1  (Poetry line level 1 → indent)",
  q2:  "\\q2  (Poetry line level 2 → indent)",
  q3:  "\\q3  (Poetry line level 3 → indent)",
  s1:  "\\s1  (Section heading level 1)",
  s2:  "\\s2  (Section heading level 2)",
};

function MarkerInventory({ inv, stats }: { inv: { preserved: string[]; stripped: string[] }; stats: { chapters: number; verses: number } }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden text-sm">
      <button
        type="button"
        onClick={() => setExpanded(x => !x)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
      >
        <span>USFM marker summary — {stats.chapters} chapter{stats.chapters !== 1 ? "s" : ""}, {stats.verses} verse{stats.verses !== 1 ? "s" : ""}</span>
        <span className="text-stone-400">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          {inv.preserved.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-1.5">Preserved</p>
              <ul className="space-y-0.5">
                {inv.preserved.map(m => (
                  <li key={m} className="flex items-start gap-2">
                    <span className="text-green-600 dark:text-green-400 font-bold mt-0.5">✓</span>
                    <span className="font-mono text-xs text-stone-700 dark:text-stone-300">
                      {MARKER_LABELS[m] ?? `\\${m}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {inv.stripped.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1.5">Stripped (not imported)</p>
              <ul className="space-y-0.5">
                {inv.stripped.map(m => (
                  <li key={m} className="flex items-start gap-2">
                    <span className="text-red-500 dark:text-red-400 font-bold mt-0.5">✕</span>
                    <span className="font-mono text-xs text-stone-500 dark:text-stone-400">\\{m}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {inv.stripped.length === 0 && inv.preserved.length === 0 && (
            <p className="text-xs text-stone-400">No markers detected.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ImportForm({ books, existingTranslations }: ImportFormProps) {
  const { t, bookName } = useTranslation();
  const router = useRouter();

  // Tab state
  const [activeTab, setActiveTab] = useState<"paste" | "usfm">("paste");

  // ── Paste-text form ────────────────────────────────────────────────────────
  const [state, formAction, pending] = useActionState(importTranslationAction, INITIAL_STATE);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [abbreviation, setAbbreviation] = useState("");
  const [checking, setChecking] = useState(false);
  const [confirmData, setConfirmData] = useState<{
    formData: FormData;
    existingCount: number;
    abbr: string;
    bookName: string;
    chapter: number;
  } | null>(null);

  useEffect(() => {
    if (state.redirectTo) router.push(state.redirectTo);
  }, [state.redirectTo, router]);

  // ── USFM file form ─────────────────────────────────────────────────────────
  const [usfmState, usfmFormAction, usfmPending] = useActionState(importUsfmFileAction, INITIAL_USFM_STATE);
  const [usfmName, setUsfmName] = useState("");
  const [usfmAbbr, setUsfmAbbr] = useState("");
  const [usfmSelectedId, setUsfmSelectedId] = useState<number | null>(null);
  const [importMode, setImportMode] = useState<"file" | "folder">("file");
  // Single-file mode
  const [parsedFile, setParsedFile] = useState<ParsedUsfmFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Folder mode
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [folderPreviews, setFolderPreviews] = useState<Array<{ name: string; parsed: ParsedUsfmFile | null; error: string | null }>>([]);
  const [folderParsing, setFolderParsing] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  // Folder import progress (sequential per-file)
  const [folderImporting, setFolderImporting] = useState(false);
  const [folderProgress, setFolderProgress] = useState<{ done: number; total: number; currentBook: string } | null>(null);
  const [folderErrors, setFolderErrors] = useState<string[]>([]);
  const [folderImportDone, setFolderImportDone] = useState(false);

  useEffect(() => {
    if (usfmState.redirectTo) router.push(usfmState.redirectTo);
  }, [usfmState.redirectTo, router]);

  const USFM_EXT = /\.(usfm|sfm)$/i;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setParsedFile(null);
    setFileError(null);
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const result = parseUsfmFile(text);
        if (result.verses.length === 0) {
          setFileError("No verses detected. Check that the file is a valid USFM file.");
        } else {
          setParsedFile(result);
        }
      } catch (err) {
        setFileError("Failed to parse USFM file: " + String(err));
      }
    };
    reader.readAsText(file);
  }

  async function handleFolderChange(e: React.ChangeEvent<HTMLInputElement>) {
    const allFiles = Array.from(e.target.files ?? []);
    const usfmFiles = allFiles.filter(f => USFM_EXT.test(f.name));
    setFolderFiles(usfmFiles);
    setFolderPreviews([]);
    if (usfmFiles.length === 0) return;

    setFolderParsing(true);
    const results: typeof folderPreviews = [];
    for (const file of usfmFiles) {
      try {
        const text = await file.text();
        const parsed = parseUsfmFile(text);
        results.push({ name: file.name, parsed: parsed.verses.length > 0 ? parsed : null, error: parsed.verses.length === 0 ? "No verses found" : null });
      } catch (err) {
        results.push({ name: file.name, parsed: null, error: String(err) });
      }
    }
    setFolderPreviews(results);
    setFolderParsing(false);
  }

  // Merged marker inventory across all successfully parsed folder files
  const mergedInv = (() => {
    const preserved = new Set<string>();
    const stripped = new Set<string>();
    let chapters = 0, verses = 0;
    for (const fp of folderPreviews) {
      if (!fp.parsed) continue;
      fp.parsed.markerInventory.preserved.forEach(m => preserved.add(m));
      fp.parsed.markerInventory.stripped.forEach(m => stripped.add(m));
      chapters += fp.parsed.stats.chapters;
      verses += fp.parsed.stats.verses;
    }
    return { preserved: [...preserved], stripped: [...stripped], chapters, verses };
  })();

  function selectTranslation(tr: Translation) {
    if (selectedId === tr.id) {
      setSelectedId(null); setName(""); setAbbreviation("");
    } else {
      setSelectedId(tr.id); setName(tr.name); setAbbreviation(tr.abbreviation);
    }
  }

  function selectUsfmTranslation(tr: Translation) {
    if (usfmSelectedId === tr.id) {
      setUsfmSelectedId(null); setUsfmName(""); setUsfmAbbr("");
    } else {
      setUsfmSelectedId(tr.id); setUsfmName(tr.name); setUsfmAbbr(tr.abbreviation);
    }
  }

  async function handleFolderImport() {
    const validPreviews = folderPreviews.filter(f => f.parsed);
    if (validPreviews.length === 0 || !usfmName.trim() || !usfmAbbr.trim()) return;

    setFolderImporting(true);
    setFolderImportDone(false);
    setFolderErrors([]);
    setFolderProgress({ done: 0, total: validPreviews.length, currentBook: "" });

    const errors: string[] = [];
    let firstRedirect: string | null = null;

    for (let i = 0; i < validPreviews.length; i++) {
      const preview = validPreviews[i];
      setFolderProgress({ done: i, total: validPreviews.length, currentBook: preview.parsed?.detectedBook ?? preview.name });

      const match = folderFiles.find(f => f.name === preview.name);
      if (!match) { errors.push(`${preview.name}: file not found`); continue; }

      const fd = new FormData();
      fd.set("name", usfmName.trim());
      fd.set("abbreviation", usfmAbbr.trim().toUpperCase());
      fd.set("usfmFile", match);

      try {
        const result = await importUsfmFileAction(INITIAL_USFM_STATE, fd);
        if (!result.success && result.error) {
          errors.push(`${preview.parsed?.detectedBook ?? preview.name}: ${result.error}`);
        } else if (result.redirectTo && !firstRedirect) {
          firstRedirect = result.redirectTo;
        }
      } catch (e) {
        errors.push(`${preview.parsed?.detectedBook ?? preview.name}: ${String(e)}`);
      }
    }

    setFolderProgress({ done: validPreviews.length, total: validPreviews.length, currentBook: "" });
    setFolderErrors(errors);
    setFolderImporting(false);
    setFolderImportDone(true);

    if (firstRedirect) router.push(firstRedirect);
  }

  async function handlePasteSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const abbr = ((formData.get("abbreviation") as string) ?? "").trim().toUpperCase();
    const osisBook = ((formData.get("osisBook") as string) ?? "").trim();
    const chapter = parseInt((formData.get("chapter") as string) ?? "", 10);
    setChecking(true);
    try {
      const { count } = await checkExistingVersesAction(abbr, osisBook, chapter);
      if (count > 0) {
        setConfirmData({ formData, existingCount: count, abbr, bookName: bookName(osisBook), chapter });
      } else {
        startTransition(() => formAction(formData));
      }
    } catch {
      startTransition(() => formAction(formData));
    } finally {
      setChecking(false);
    }
  }

  const otCodes = OSIS_BOOKS_OT.filter((c) => books.some((b) => b.osisCode === c));
  const ntCodes = OSIS_BOOKS_NT.filter((c) => books.some((b) => b.osisCode === c));

  const tabBtnClass = (active: boolean) =>
    `px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
      active
        ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
        : "border-transparent text-stone-500 hover:text-stone-700 dark:hover:text-stone-200"
    }`;

  return (
    <>
      <header className="mb-8">
        <Link
          href="/"
          className="text-sm text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 mb-4 inline-block transition-colors"
        >
          {t("importPage.backLink")}
        </Link>
        <h1 className="text-3xl font-bold mt-2">{t("importPage.title")}</h1>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          {t("importPage.description")}
        </p>
      </header>

      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-[var(--border)] mb-6">
        <button type="button" className={tabBtnClass(activeTab === "paste")} onClick={() => setActiveTab("paste")}>
          Paste Text
        </button>
        <button type="button" className={tabBtnClass(activeTab === "usfm")} onClick={() => setActiveTab("usfm")}>
          USFM File
        </button>
      </div>

      {/* ── Paste text tab ── */}
      {activeTab === "paste" && (
        <form onSubmit={handlePasteSubmit} className="space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300 mb-3">
              {t("importPage.translationHeading")}
            </h2>
            {existingTranslations.length > 0 && (
              <div className="mb-3">
                <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">{t("importPage.existingHint")}</p>
                <div className="flex flex-wrap gap-2">
                  {existingTranslations.map((tr) => (
                    <button
                      key={tr.id} type="button" onClick={() => selectTranslation(tr)} title={tr.name}
                      className={[
                        "px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-colors border",
                        selectedId === tr.id
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-[var(--surface)] text-stone-600 dark:text-stone-300 border-[var(--border)] hover:border-blue-400",
                      ].join(" ")}
                    >
                      {tr.abbreviation}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300" htmlFor="name">
                  {t("importPage.fullName")}
                </label>
                <input id="name" name="name" type="text" required placeholder={t("importPage.fullNamePlaceholder")}
                  value={name} onChange={(e) => { setName(e.target.value); setSelectedId(null); }} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300" htmlFor="abbreviation">
                  {t("importPage.abbreviation")}
                </label>
                <input id="abbreviation" name="abbreviation" type="text" required placeholder={t("importPage.abbreviationPlaceholder")}
                  maxLength={12} value={abbreviation} onChange={(e) => { setAbbreviation(e.target.value); setSelectedId(null); }}
                  className={inputClass + " font-mono uppercase"} />
              </div>
            </div>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300 mb-3">{t("importPage.locationHeading")}</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300" htmlFor="osisBook">
                  {t("importPage.book")}
                </label>
                <select id="osisBook" name="osisBook" required className={inputClass}>
                  <option value="">{t("importPage.selectBook")}</option>
                  {otCodes.length > 0 && (
                    <optgroup label={t("importPage.oldTestament")}>
                      {otCodes.map((c) => <option key={c} value={c}>{bookName(c)}</option>)}
                    </optgroup>
                  )}
                  {ntCodes.length > 0 && (
                    <optgroup label={t("importPage.newTestament")}>
                      {ntCodes.map((c) => <option key={c} value={c}>{bookName(c)}</option>)}
                    </optgroup>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300" htmlFor="chapter">
                  {t("importPage.chapter")}
                </label>
                <input id="chapter" name="chapter" type="number" min="1" required placeholder="1" className={inputClass} />
              </div>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300" htmlFor="pastedText">
              {t("importPage.pasteLabel")}
            </label>
            <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">{t("importPage.pasteHint")}</p>
            <textarea id="pastedText" name="pastedText" required rows={10}
              placeholder={"Genesis 1:1-31 (NIV)\n1 In the beginning God created the heavens and the earth. 2 Now the earth was formless and empty…"}
              className={inputClass + " font-mono resize-y"} />
          </div>
          {confirmData && (
            <div className="px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-1">{t("importPage.replaceTitle")}</p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mb-3">
                {t("importPage.replaceDesc", { abbr: confirmData.abbr, count: confirmData.existingCount, plural: confirmData.existingCount !== 1 ? "s" : "", book: confirmData.bookName, chapter: confirmData.chapter })}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmData(null)}
                  className="px-4 py-1.5 rounded-lg text-sm font-medium border border-[var(--border)] bg-[var(--surface)] text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors">
                  {t("importPage.cancel")}
                </button>
                <button type="button" onClick={() => { const fd = confirmData.formData; setConfirmData(null); startTransition(() => formAction(fd)); }}
                  className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors">
                  {t("importPage.yesReplace")}
                </button>
              </div>
            </div>
          )}
          {state.error && (
            <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
              {state.error}
            </div>
          )}
          {state.success && !state.redirectTo && (
            <div className="px-4 py-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 text-sm">
              {t("importPage.importedVerses", { count: state.count, plural: state.count !== 1 ? "s" : "" })}
            </div>
          )}
          <button type="submit" disabled={pending || checking || !!confirmData}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors">
            {pending ? t("importPage.importing") : checking ? t("importPage.checking") : t("importPage.importChapter")}
          </button>
        </form>
      )}

      {/* ── USFM file tab ── */}
      {activeTab === "usfm" && (
        <div className="space-y-6">
          {/* Translation identity */}
          <div>
            <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300 mb-3">Translation</h2>
            {existingTranslations.length > 0 && (
              <div className="mb-3">
                <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">Select an existing translation or enter a new one:</p>
                <div className="flex flex-wrap gap-2">
                  {existingTranslations.map((tr) => (
                    <button
                      key={tr.id} type="button" onClick={() => selectUsfmTranslation(tr)} title={tr.name}
                      className={[
                        "px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-colors border",
                        usfmSelectedId === tr.id
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-[var(--surface)] text-stone-600 dark:text-stone-300 border-[var(--border)] hover:border-blue-400",
                      ].join(" ")}
                    >
                      {tr.abbreviation}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300" htmlFor="usfm-name">Full Name</label>
                <input id="usfm-name" name="name" type="text" required placeholder="e.g. English Standard Version"
                  value={usfmName} onChange={(e) => { setUsfmName(e.target.value); setUsfmSelectedId(null); }} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300" htmlFor="usfm-abbr">Abbreviation</label>
                <input id="usfm-abbr" name="abbreviation" type="text" required placeholder="e.g. ESV" maxLength={12}
                  value={usfmAbbr} onChange={(e) => { setUsfmAbbr(e.target.value.toUpperCase()); setUsfmSelectedId(null); }}
                  className={inputClass + " font-mono uppercase"} />
              </div>
            </div>
          </div>

          {/* Import mode toggle */}
          <div>
            <div className="flex items-center gap-1 mb-4 bg-stone-100 dark:bg-stone-800 rounded-lg p-1 w-fit">
              {(["file", "folder"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setImportMode(mode);
                    setParsedFile(null); setFileError(null);
                    setFolderFiles([]); setFolderPreviews([]);
                  }}
                  className={[
                    "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
                    importMode === mode
                      ? "bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-sm"
                      : "text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200",
                  ].join(" ")}
                >
                  {mode === "file" ? "Single File" : "Folder"}
                </button>
              ))}
            </div>

            {/* Single file picker */}
            {importMode === "file" && (
              <div>
                <label className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300" htmlFor="usfmFile">
                  USFM File <span className="font-normal text-stone-400">(.usfm, .sfm)</span>
                </label>
                <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">
                  The entire book is imported. Book is detected from the <code className="font-mono">\id</code> marker.
                </p>
                <input
                  id="usfmFile" ref={fileInputRef}
                  type="file" accept=".usfm,.sfm,.SFM,.USFM,.txt"
                  onChange={handleFileChange}
                  className="block w-full text-sm text-stone-600 dark:text-stone-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-900 dark:file:text-blue-200 hover:file:bg-blue-100 dark:hover:file:bg-blue-800 transition-colors"
                />
                {fileError && (
                  <div className="mt-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
                    {fileError}
                  </div>
                )}
                {parsedFile && (
                  <div className="mt-3 space-y-2">
                    {parsedFile.detectedBook && (
                      <p className="text-sm text-stone-600 dark:text-stone-300">
                        Detected book: <strong>{parsedFile.detectedBook}</strong>
                        {parsedFile.paratextCode && parsedFile.paratextCode !== parsedFile.detectedBook && (
                          <span className="text-stone-400 ml-1">({parsedFile.paratextCode})</span>
                        )}
                      </p>
                    )}
                    <MarkerInventory inv={parsedFile.markerInventory} stats={parsedFile.stats} />
                  </div>
                )}
              </div>
            )}

            {/* Folder picker */}
            {importMode === "folder" && (
              <div>
                <label className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300" htmlFor="usfmFolder">
                  USFM Folder
                </label>
                <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">
                  All <code className="font-mono">.usfm</code> / <code className="font-mono">.sfm</code> files in the folder are imported as separate books. Each file must have a valid <code className="font-mono">\id</code> marker.
                </p>
                <input
                  id="usfmFolder" ref={folderInputRef}
                  type="file"
                  /* @ts-expect-error webkitdirectory is not in React types */
                  webkitdirectory=""
                  multiple
                  onChange={handleFolderChange}
                  className="block w-full text-sm text-stone-600 dark:text-stone-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-900 dark:file:text-blue-200 hover:file:bg-blue-100 dark:hover:file:bg-blue-800 transition-colors"
                />
                {folderParsing && (
                  <p className="mt-2 text-sm text-stone-500 dark:text-stone-400 animate-pulse">Scanning files…</p>
                )}
                {!folderParsing && folderPreviews.length > 0 && (
                  <div className="mt-3 space-y-3">
                    {/* Per-file list */}
                    <div className="rounded-lg border border-[var(--border)] overflow-hidden">
                      <div className="px-4 py-2 bg-stone-50 dark:bg-stone-800 border-b border-[var(--border)] text-xs font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wide">
                        {folderPreviews.filter(f => f.parsed).length} of {folderPreviews.length} file{folderPreviews.length !== 1 ? "s" : ""} valid
                      </div>
                      <ul className="divide-y divide-[var(--border)]">
                        {folderPreviews.map((fp) => (
                          <li key={fp.name} className="flex items-center gap-3 px-4 py-2 text-sm">
                            <span className={fp.parsed ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}>
                              {fp.parsed ? "✓" : "✕"}
                            </span>
                            <span className="font-mono text-xs text-stone-600 dark:text-stone-300 flex-1 truncate">{fp.name}</span>
                            {fp.parsed ? (
                              <span className="text-xs text-stone-400 shrink-0">
                                {fp.parsed.detectedBook} — {fp.parsed.stats.verses} verses
                              </span>
                            ) : (
                              <span className="text-xs text-red-500 dark:text-red-400 shrink-0">{fp.error}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                    {/* Merged marker summary */}
                    {mergedInv.verses > 0 && (
                      <MarkerInventory
                        inv={{ preserved: mergedInv.preserved, stripped: mergedInv.stripped }}
                        stats={{ chapters: mergedInv.chapters, verses: mergedInv.verses }}
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Server errors / success */}
          {usfmState.error && (
            <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
              {usfmState.error}
            </div>
          )}
          {/* Single-file success */}
          {importMode === "file" && usfmState.success && !usfmState.redirectTo && (
            <div className="px-4 py-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 text-sm">
              Imported {usfmState.count} verse{usfmState.count !== 1 ? "s" : ""}
              {usfmState.detectedBook ? ` for ${usfmState.detectedBook}` : ""}.
            </div>
          )}

          {/* Folder import progress */}
          {importMode === "folder" && folderProgress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400">
                <span>
                  {folderImporting
                    ? `Importing${folderProgress.currentBook ? ` ${folderProgress.currentBook}` : ""}…`
                    : folderImportDone ? "Import complete" : ""}
                </span>
                <span>{folderProgress.done} / {folderProgress.total}</span>
              </div>
              <div className="w-full h-1.5 bg-stone-200 dark:bg-stone-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${(folderProgress.done / folderProgress.total) * 100}%` }}
                />
              </div>
              {folderImportDone && folderErrors.length > 0 && (
                <div className="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-xs space-y-0.5">
                  {folderErrors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}
            </div>
          )}

          {(!usfmName.trim() || !usfmAbbr.trim()) && (
            importMode === "file" ? !!parsedFile && !fileError : folderPreviews.filter(f => f.parsed).length > 0
          ) && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Enter a translation name and abbreviation above to enable import.
            </p>
          )}

          <button
            type="button"
            disabled={
              folderImporting || usfmPending || !usfmName.trim() || !usfmAbbr.trim() ||
              (importMode === "file" ? !parsedFile || !!fileError : folderPreviews.filter(f => f.parsed).length === 0)
            }
            onClick={() => {
              if (importMode === "folder") {
                handleFolderImport();
              } else {
                const fd = new FormData();
                fd.set("name", usfmName.trim());
                fd.set("abbreviation", usfmAbbr.trim().toUpperCase());
                const file = fileInputRef.current?.files?.[0];
                if (file) fd.set("usfmFile", file);
                startTransition(() => usfmFormAction(fd));
              }
            }}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {folderImporting
              ? `Importing… (${folderProgress?.done ?? 0} / ${folderProgress?.total ?? 0})`
              : usfmPending
                ? "Importing…"
                : importMode === "folder"
                  ? `Import ${folderPreviews.filter(f => f.parsed).length} Book${folderPreviews.filter(f => f.parsed).length !== 1 ? "s" : ""}`
                  : "Import USFM File"}
          </button>
        </div>
      )}
    </>
  );
}
