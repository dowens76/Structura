"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/LocaleContext";
import { OSIS_BOOKS_OT, OSIS_BOOKS_NT, OSIS_BOOKS_LXX } from "@/lib/utils/osis";

// ── Types (mirrors app/account/AccountPanel.tsx's import feature) ────────────

interface Workspace {
  id: number;
  userId: number;
  name: string;
  translationOnly: boolean;
  createdAt: string;
}

type OverwritableDataType = "translationVerses" | "lineAnnotations";
type OverwriteChoice = "overwrite" | "skip";

interface ConflictInfo {
  exists: boolean;
  count: number;
}

interface DataTypes {
  translationVerses: boolean;
  sectionBreaks: boolean;
  paragraphBreaks: boolean;
  lineAnnotations: boolean;
  wordTags: boolean;
  wordFormatting: boolean;
  characters: boolean;
  lineIndents: boolean;
  wordArrows: boolean;
  rstRelations: boolean;
  notes: boolean;
  passages: boolean;
  constituentLabels: boolean;
  transliterationFormats: boolean;
  textCriticalMarks: boolean;
  paragraphHeadings: boolean;
  translationFootnotes: boolean;
  translationVersions: boolean;
  wordDatasets: boolean;
  bookGroupings: boolean;
  bookmarks: boolean;
  intertextualLinks: boolean;
}

interface ImportForm {
  sourceWorkspaceId: number;
  scopeType: "chapter" | "passage";
  book: string;
  chapter: number;
  passageId: number;
  dataTypes: DataTypes;
}

interface ImportResult {
  [key: string]: { imported: number };
}

export type CopyScope =
  | { type: "chapter"; book: string; chapter: number }
  | { type: "passage"; passageId: number };

interface Props {
  /** Workspace currently active — the copy destination. Excluded from the source list. */
  activeWorkspaceId: number;
  /** Current chapter or passage context — pre-fills (but doesn't lock) the scope fields. */
  scope: CopyScope;
}

const ALL_DATA_TYPES_TRUE: DataTypes = {
  translationVerses: true, sectionBreaks: true, paragraphBreaks: true,
  lineAnnotations: true, wordTags: true, wordFormatting: true,
  characters: true, lineIndents: true, wordArrows: true, rstRelations: true,
  notes: true, passages: true, constituentLabels: true,
  transliterationFormats: true, textCriticalMarks: true, paragraphHeadings: true,
  translationFootnotes: true, translationVersions: true, wordDatasets: true,
  bookGroupings: true, bookmarks: true, intertextualLinks: true,
};

const ALL_DATA_TYPES_FALSE: DataTypes = Object.fromEntries(
  Object.keys(ALL_DATA_TYPES_TRUE).map((key) => [key, false])
) as unknown as DataTypes;

const DATA_TYPE_KEYS: { key: keyof DataTypes; tKey: string }[] = [
  { key: "translationVerses", tKey: "account.dataTypeTranslationVerses" },
  { key: "sectionBreaks", tKey: "account.dataTypeSectionBreaks" },
  { key: "paragraphBreaks", tKey: "account.dataTypeParagraphBreaks" },
  { key: "lineAnnotations", tKey: "account.dataTypeLineAnnotations" },
  { key: "wordTags", tKey: "account.dataTypeWordTags" },
  { key: "wordFormatting", tKey: "account.dataTypeWordFormatting" },
  { key: "characters", tKey: "account.dataTypeCharacters" },
  { key: "lineIndents", tKey: "account.dataTypeLineIndents" },
  { key: "wordArrows", tKey: "account.dataTypeWordArrows" },
  { key: "rstRelations", tKey: "account.dataTypeRstRelations" },
  { key: "notes", tKey: "account.dataTypeNotes" },
  { key: "passages", tKey: "account.dataTypePassages" },
  { key: "constituentLabels", tKey: "account.dataTypeConstituentLabels" },
  { key: "transliterationFormats", tKey: "account.dataTypeTransliterationFormats" },
  { key: "textCriticalMarks", tKey: "account.dataTypeTextCriticalMarks" },
  { key: "paragraphHeadings", tKey: "account.dataTypeParagraphHeadings" },
  { key: "translationFootnotes", tKey: "account.dataTypeTranslationFootnotes" },
  { key: "translationVersions", tKey: "account.dataTypeTranslationVersions" },
  { key: "wordDatasets", tKey: "account.dataTypeWordDatasets" },
  { key: "bookGroupings", tKey: "account.dataTypeBookGroupings" },
  { key: "bookmarks", tKey: "account.dataTypeBookmarks" },
  { key: "intertextualLinks", tKey: "account.dataTypeIntertextualLinks" },
];

const IMPORT_BOOK_OPTIONS: string[] = [
  ...OSIS_BOOKS_OT,
  ...OSIS_BOOKS_LXX.filter((b) => !OSIS_BOOKS_OT.includes(b)),
  ...OSIS_BOOKS_NT,
];

const inputClass =
  "w-full px-2 py-1.5 rounded-lg text-sm";

function buildDefaultForm(scope: CopyScope): ImportForm {
  return {
    sourceWorkspaceId: 0,
    scopeType: scope.type,
    book: scope.type === "chapter" ? scope.book : "",
    chapter: scope.type === "chapter" ? scope.chapter : 1,
    passageId: scope.type === "passage" ? scope.passageId : 0,
    dataTypes: ALL_DATA_TYPES_TRUE,
  };
}

export default function CopyFromWorkspaceDialog({ activeWorkspaceId, scope }: Props) {
  const { t, bookName } = useTranslation();
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  // True once an import has actually written data this time the dialog was open.
  // ChapterDisplay seeds most of its annotation state from its initial* props
  // only on mount (see components/text/ChapterDisplay.tsx), so a soft
  // router.refresh() re-renders the page with fresh props but the already-
  // mounted component keeps showing its stale state. A full reload forces a
  // remount, which is the only way to make the copied data appear without the
  // user having to navigate away and back.
  const [didImport, setDidImport] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [importForm, setImportForm] = useState<ImportForm>(() => buildDefaultForm(scope));
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [importChecking, setImportChecking] = useState(false);
  const [importConflicts, setImportConflicts] = useState<Partial<
    Record<OverwritableDataType, ConflictInfo>
  > | null>(null);
  const [importOverwriteChoices, setImportOverwriteChoices] = useState<
    Partial<Record<OverwritableDataType, OverwriteChoice>>
  >({});

  // Fetch workspaces + reset transient state each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setImportForm(buildDefaultForm(scope));
    setImportResult(null);
    setImportError("");
    setImportConflicts(null);
    setDidImport(false);
    fetch("/api/users")
      .then((r) => r.json())
      .then(async (data: { users?: { id: number }[] }) => {
        if (data.users?.length) {
          const userId = data.users[0].id;
          const r2 = await fetch(`/api/workspaces?userId=${userId}`);
          const d2 = await r2.json();
          setWorkspaces(d2.workspaces ?? []);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Closing the dialog after a successful import does a full reload instead of
  // just hiding it (see the didImport comment above).
  function closeDialog() {
    if (didImport) {
      window.location.reload();
      return;
    }
    setOpen(false);
  }

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) closeDialog();
    }
    function keyHandler(e: KeyboardEvent) {
      if (e.key === "Escape") closeDialog();
    }
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, didImport]);

  function buildImportRequest() {
    const reqScope =
      importForm.scopeType === "chapter"
        ? { type: "chapter" as const, book: importForm.book.trim(), chapter: importForm.chapter }
        : { type: "passage" as const, passageId: importForm.passageId };
    const dataTypes = DATA_TYPE_KEYS.map((d) => d.key).filter((key) => importForm.dataTypes[key]);
    return { scope: reqScope, dataTypes };
  }

  async function runImport(overwrite?: Partial<Record<OverwritableDataType, OverwriteChoice>>) {
    setImportLoading(true);
    try {
      const { scope: reqScope, dataTypes } = buildImportRequest();
      const res = await fetch("/api/workspace-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceWorkspaceId: importForm.sourceWorkspaceId,
          scope: reqScope,
          dataTypes,
          overwrite,
        }),
      });
      const data = (await res.json()) as { ok: true; results: ImportResult } | { error: string };
      if (!res.ok) {
        setImportError("error" in data ? data.error : "Import failed.");
      } else if ("results" in data) {
        setImportResult(data.results);
        setDidImport(true);
        router.refresh();
      }
    } catch {
      setImportError("Network error — could not reach the server.");
    } finally {
      setImportLoading(false);
    }
  }

  async function submitImport() {
    setImportError("");
    setImportResult(null);
    setImportConflicts(null);
    if (!importForm.sourceWorkspaceId) {
      setImportError("Please select a source workspace.");
      return;
    }
    if (importForm.scopeType === "chapter" && !importForm.book.trim()) {
      setImportError("Please enter a book abbreviation.");
      return;
    }
    if (importForm.scopeType === "passage" && (!importForm.passageId || importForm.passageId < 1)) {
      setImportError("Please enter a valid passage ID.");
      return;
    }

    const { scope: reqScope, dataTypes } = buildImportRequest();

    setImportChecking(true);
    try {
      const checkRes = await fetch("/api/workspace-import/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceWorkspaceId: importForm.sourceWorkspaceId,
          scope: reqScope,
          dataTypes,
        }),
      });
      if (checkRes.ok) {
        const { conflicts } = (await checkRes.json()) as {
          conflicts: Partial<Record<OverwritableDataType, ConflictInfo>>;
        };
        const conflictingTypes = (Object.keys(conflicts) as OverwritableDataType[]).filter(
          (k) => conflicts[k]?.exists
        );
        if (conflictingTypes.length > 0) {
          setImportConflicts(conflicts);
          setImportOverwriteChoices(Object.fromEntries(conflictingTypes.map((k) => [k, "skip"])));
          return;
        }
      }
    } catch {
      // Non-blocking — fall through to the real import if the check fails.
    } finally {
      setImportChecking(false);
    }

    await runImport();
  }

  async function confirmImportWithChoices() {
    await runImport(importOverwriteChoices);
    setImportConflicts(null);
  }

  const otherWorkspaces = workspaces.filter((w) => w.id !== activeWorkspaceId);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs px-2 py-1 rounded transition-colors"
        style={{ color: "var(--nav-fg)" }}
        title={t("nav.titleCopyFromWorkspace")}
      >
        {t("nav.copyFromWorkspace")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4"
          style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
        >
          <div
            ref={dialogRef}
            className="w-full max-w-lg rounded-xl shadow-2xl border overflow-hidden"
            style={{ backgroundColor: "var(--background)", borderColor: "var(--border)" }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 border-b"
              style={{ borderColor: "var(--border)" }}
            >
              <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                {t("nav.copyFromWorkspace")}
              </h2>
              <button
                onClick={closeDialog}
                className="text-xs px-2 py-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800"
                style={{ color: "var(--text-muted)" }}
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="px-4 py-4 max-h-[75vh] overflow-y-auto space-y-4">
              {/* Source workspace */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
                  {t("account.sourceWorkspace")}
                </label>
                <select
                  value={importForm.sourceWorkspaceId}
                  onChange={(e) =>
                    setImportForm((f) => ({ ...f, sourceWorkspaceId: parseInt(e.target.value, 10) }))
                  }
                  className={inputClass}
                  style={{ backgroundColor: "var(--background)", border: "1px solid var(--border)", color: "var(--foreground)" }}
                >
                  <option value={0}>{t("account.selectWorkspace")}</option>
                  {otherWorkspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      {ws.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Scope type */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
                  {t("account.scope")}
                </label>
                <div className="flex gap-4">
                  {(["chapter", "passage"] as const).map((type) => (
                    <label key={type} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--foreground)" }}>
                      <input
                        type="radio"
                        name="copyScopeType"
                        value={type}
                        checked={importForm.scopeType === type}
                        onChange={() => setImportForm((f) => ({ ...f, scopeType: type }))}
                      />
                      {type === "chapter" ? t("account.scopeChapter") : t("account.scopePassage")}
                    </label>
                  ))}
                </div>
              </div>

              {/* Scope details */}
              {importForm.scopeType === "chapter" ? (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
                      {t("account.bookLabel")}
                    </label>
                    <select
                      value={importForm.book}
                      onChange={(e) => setImportForm((f) => ({ ...f, book: e.target.value }))}
                      className={inputClass}
                      style={{ backgroundColor: "var(--background)", border: "1px solid var(--border)", color: "var(--foreground)" }}
                    >
                      <option value="">{t("account.selectBook")}</option>
                      {IMPORT_BOOK_OPTIONS.map((code) => (
                        <option key={code} value={code}>
                          {bookName(code)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
                      {t("account.chapterLabel")}
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={importForm.chapter}
                      onChange={(e) =>
                        setImportForm((f) => ({ ...f, chapter: parseInt(e.target.value, 10) || 1 }))
                      }
                      className={`${inputClass} w-24`}
                      style={{ backgroundColor: "var(--background)", border: "1px solid var(--border)", color: "var(--foreground)" }}
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
                    {t("account.passageIdLabel")}
                  </label>
                  <input
                    type="number"
                    min={1}
                    placeholder={t("account.passageIdPlaceholder")}
                    value={importForm.passageId || ""}
                    onChange={(e) =>
                      setImportForm((f) => ({ ...f, passageId: parseInt(e.target.value, 10) || 0 }))
                    }
                    className={`${inputClass} w-40`}
                    style={{ backgroundColor: "var(--background)", border: "1px solid var(--border)", color: "var(--foreground)" }}
                  />
                  {!(scope.type === "passage") && (
                    <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>
                      {t("account.passageIdHelp")}
                    </p>
                  )}
                </div>
              )}

              {/* Data types */}
              <div>
                <label className="block text-xs font-medium mb-2" style={{ color: "var(--text-muted)" }}>
                  {t("account.dataToImport")}
                </label>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {DATA_TYPE_KEYS.map(({ key, tKey }) => (
                    <label key={key} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--foreground)" }}>
                      <input
                        type="checkbox"
                        checked={importForm.dataTypes[key]}
                        onChange={(e) =>
                          setImportForm((f) => ({
                            ...f,
                            dataTypes: { ...f.dataTypes, [key]: e.target.checked },
                          }))
                        }
                        className="w-3.5 h-3.5 shrink-0"
                      />
                      {t(tKey)}
                    </label>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    className="text-xs underline-offset-2 hover:underline"
                    style={{ color: "var(--text-muted)" }}
                    onClick={() =>
                      setImportForm((f) => ({ ...f, dataTypes: ALL_DATA_TYPES_TRUE }))
                    }
                  >
                    {t("account.selectAll")}
                  </button>
                  <button
                    className="text-xs underline-offset-2 hover:underline"
                    style={{ color: "var(--text-muted)" }}
                    onClick={() =>
                      setImportForm((f) => ({ ...f, dataTypes: ALL_DATA_TYPES_FALSE }))
                    }
                  >
                    {t("account.deselectAll")}
                  </button>
                </div>
              </div>

              {/* Overwrite/skip conflict resolution */}
              {importConflicts ? (
                <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-4 py-3 space-y-3">
                  <div>
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                      {t("account.importConflictTitle")}
                    </p>
                    <p className="text-xs mt-0.5 text-amber-800 dark:text-amber-200">
                      {t("account.importConflictDesc")}
                    </p>
                  </div>
                  {(Object.keys(importConflicts) as OverwritableDataType[])
                    .filter((key) => importConflicts[key]?.exists)
                    .map((key) => {
                      const tKey = DATA_TYPE_KEYS.find((d) => d.key === key)?.tKey;
                      const info = importConflicts[key]!;
                      return (
                        <div key={key} className="flex items-center justify-between gap-3">
                          <div className="text-xs text-amber-900 dark:text-amber-100">
                            <span className="font-medium">{tKey ? t(tKey) : key}</span>
                            <span className="ml-2 opacity-75">
                              {t("account.importConflictCount", { count: info.count })}
                            </span>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            {(["skip", "overwrite"] as const).map((choice) => (
                              <button
                                key={choice}
                                type="button"
                                onClick={() =>
                                  setImportOverwriteChoices((prev) => ({ ...prev, [key]: choice }))
                                }
                                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                                  importOverwriteChoices[key] === choice
                                    ? choice === "overwrite"
                                      ? "bg-red-600 text-white"
                                      : "bg-stone-600 text-white"
                                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
                                }`}
                              >
                                {choice === "overwrite"
                                  ? t("account.importConflictOverwrite")
                                  : t("account.importConflictSkip")}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={confirmImportWithChoices}
                      disabled={importLoading}
                      className="px-4 py-2 rounded-lg text-xs font-medium text-white transition-opacity disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
                      style={{ backgroundColor: "var(--accent)" }}
                    >
                      {importLoading ? t("account.importing") : t("account.importContinue")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportConflicts(null)}
                      disabled={importLoading}
                      className="px-3 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ backgroundColor: "var(--surface-muted)", border: "1px solid var(--border)", color: "var(--foreground)" }}
                    >
                      {t("account.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={submitImport}
                    disabled={importLoading || importChecking}
                    className="px-4 py-2 rounded-lg text-xs font-medium text-white transition-opacity disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
                    style={{ backgroundColor: "var(--accent)" }}
                  >
                    {importLoading
                      ? t("account.importing")
                      : importChecking
                      ? t("account.importChecking")
                      : t("account.import")}
                  </button>
                  {(importLoading || importChecking) && (
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {t("account.importingMoment")}
                    </span>
                  )}
                </div>
              )}

              {/* Error */}
              {importError && (
                <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
                  {importError}
                </div>
              )}

              {/* Result */}
              {importResult && (
                <div className="rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
                  <p className="font-medium mb-2">{t("account.importComplete")}</p>
                  <ul className="space-y-0.5 text-xs font-mono opacity-80">
                    {Object.entries(importResult)
                      .filter(([, v]) => v.imported > 0)
                      .map(([key, v]) => (
                        <li key={key}>
                          {key}: {v.imported.toLocaleString()} imported
                        </li>
                      ))}
                    {Object.values(importResult).every((v) => v.imported === 0) && (
                      <li>{t("account.nothingToImport")}</li>
                    )}
                  </ul>
                  <button
                    type="button"
                    onClick={closeDialog}
                    className="mt-3 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90"
                    style={{ backgroundColor: "var(--accent)" }}
                  >
                    {t("nav.reloadToSeeChanges")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
