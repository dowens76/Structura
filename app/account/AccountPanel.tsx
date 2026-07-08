"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "@/lib/i18n/LocaleContext";
import { OSIS_BOOKS_OT, OSIS_BOOKS_NT, OSIS_BOOKS_LXX } from "@/lib/utils/osis";

// ── Types ────────────────────────────────────────────────────────────────────

interface User {
  id: number;
  name: string;
  email: string;
  createdAt: string;
}

interface Workspace {
  id: number;
  userId: number;
  name: string;
  translationOnly: boolean;
  createdAt: string;
}

interface ImportForm {
  sourceWorkspaceId: number;
  scopeType: "chapter" | "passage";
  book: string;
  chapter: number;
  passageId: number;
  dataTypes: {
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
  };
}

interface ImportResult {
  [key: string]: { imported: number };
}

/** Data types the copy feature checks for pre-existing target data. */
type OverwritableDataType = "translationVerses" | "lineAnnotations";
type OverwriteChoice = "overwrite" | "skip";

interface ConflictInfo {
  exists: boolean;
  count: number;
}

interface Props {
  activeWorkspaceId: number;
}

// ── Shared style helpers ─────────────────────────────────────────────────────

const sectionStyle: React.CSSProperties = {
  backgroundColor: "var(--surface)",
  border: "1px solid var(--border)",
};

const inputStyle: React.CSSProperties = {
  backgroundColor: "var(--background)",
  border: "1px solid var(--border)",
  color: "var(--foreground)",
  outline: "none",
};

const mutedStyle: React.CSSProperties = { color: "var(--text-muted)" };
const fgStyle: React.CSSProperties = { color: "var(--foreground)" };

// Neutral button (stone-like)
function BtnNeutral({
  onClick,
  disabled,
  title,
  children,
  className = "",
}: {
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
      style={{
        backgroundColor: "var(--surface-muted)",
        border: "1px solid var(--border)",
        color: "var(--foreground)",
      }}
      onMouseEnter={(e) => {
        if (!disabled)
          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
            "var(--border)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor =
          "var(--surface-muted)";
      }}
    >
      {children}
    </button>
  );
}

// Accent/primary button
function BtnPrimary({
  onClick,
  disabled,
  type = "button",
  children,
  className = "",
}: {
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 ${className}`}
      style={{ backgroundColor: "var(--accent)" }}
    >
      {children}
    </button>
  );
}

// Danger button
function BtnDanger({
  onClick,
  disabled,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1 rounded-lg text-xs font-medium text-white transition-opacity disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
      style={{ backgroundColor: "#dc2626" }}
    >
      {children}
    </button>
  );
}

// ── Book options for the import scope picker ─────────────────────────────────
// OT canon, then LXX-only apocrypha (Wis, Sir, etc. — workspaces may hold data
// for these even though they're not part of the standard OT list), then NT.
const IMPORT_BOOK_OPTIONS: string[] = [
  ...OSIS_BOOKS_OT,
  ...OSIS_BOOKS_LXX.filter((b) => !OSIS_BOOKS_OT.includes(b)),
  ...OSIS_BOOKS_NT,
];

// ── Default import form ──────────────────────────────────────────────────────

const defaultImportForm: ImportForm = {
  sourceWorkspaceId: 0,
  scopeType: "chapter",
  book: "",
  chapter: 1,
  passageId: 0,
  dataTypes: {
    translationVerses: true,
    sectionBreaks: true,
    paragraphBreaks: true,
    lineAnnotations: true,
    wordTags: true,
    wordFormatting: true,
    characters: true,
    lineIndents: true,
    wordArrows: true,
    rstRelations: true,
    notes: true,
    passages: true,
    constituentLabels: true,
    transliterationFormats: true,
    textCriticalMarks: true,
    paragraphHeadings: true,
    translationFootnotes: true,
    translationVersions: true,
    wordDatasets: true,
    bookGroupings: true,
    bookmarks: true,
    intertextualLinks: true,
  },
};

const DATA_TYPE_KEYS: { key: keyof ImportForm["dataTypes"]; tKey: string }[] = [
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

// ── Main component ───────────────────────────────────────────────────────────

export default function AccountPanel({ activeWorkspaceId: initialActiveId }: Props) {
  const { t, bookName } = useTranslation();
  const router = useRouter();

  // ── Core state ─────────────────────────────────────────────────────────────
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(initialActiveId);

  // User editing
  const [editingUser, setEditingUser] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");

  // Workspace management
  const [showNewWorkspaceForm, setShowNewWorkspaceForm] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // General error
  const [error, setError] = useState("");

  // Import state
  const [importForm, setImportForm] = useState<ImportForm>(defaultImportForm);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [importChecking, setImportChecking] = useState(false);
  // Set once a check finds pre-existing target data; cleared once the user
  // resolves it (or a fresh submit starts over). Non-null means "awaiting
  // the user's overwrite/skip choice before the real import can run".
  const [importConflicts, setImportConflicts] = useState<Partial<
    Record<OverwritableDataType, ConflictInfo>
  > | null>(null);
  const [importOverwriteChoices, setImportOverwriteChoices] = useState<
    Partial<Record<OverwritableDataType, OverwriteChoice>>
  >({});

  // ── Data loading ───────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((data: { users?: User[] }) => {
        if (data.users?.[0]) {
          const u = data.users[0];
          setUser(u);
          setEditName(u.name);
          setEditEmail(u.email);
          fetch(`/api/workspaces?userId=${u.id}`)
            .then((r) => r.json())
            .then((d: { workspaces?: Workspace[] }) =>
              setWorkspaces(d.workspaces ?? [])
            );
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // ── Workspace switch ───────────────────────────────────────────────────────
  function switchToWorkspace(id: number) {
    document.cookie = `structura_active_workspace=${id}; path=/; SameSite=Lax`;
    setActiveWorkspaceId(id);
    router.refresh();
  }

  // ── User edit ──────────────────────────────────────────────────────────────
  async function saveUser() {
    if (!user) return;
    setError("");
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, email: editEmail }),
    });
    const data = (await res.json()) as { user?: User; error?: string };
    if (!res.ok) {
      setError(data.error ?? "Failed to update user.");
      return;
    }
    if (data.user) setUser(data.user);
    setEditingUser(false);
  }

  // ── Workspace create ───────────────────────────────────────────────────────
  async function createWorkspace() {
    if (!user || !newWorkspaceName.trim()) return;
    setError("");
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, name: newWorkspaceName.trim() }),
    });
    const data = (await res.json()) as { workspace?: Workspace; error?: string };
    if (!res.ok) {
      setError(data.error ?? "Failed to create workspace.");
      return;
    }
    if (data.workspace) {
      setWorkspaces((prev) => [...prev, data.workspace!]);
    }
    setNewWorkspaceName("");
    setShowNewWorkspaceForm(false);
  }

  // ── Workspace rename ───────────────────────────────────────────────────────
  async function renameWorkspace(id: number) {
    if (!renameValue.trim()) return;
    setError("");
    const res = await fetch(`/api/workspaces/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue.trim() }),
    });
    const data = (await res.json()) as { workspace?: Workspace; error?: string };
    if (!res.ok) {
      setError(data.error ?? "Failed to rename workspace.");
      return;
    }
    if (data.workspace) {
      setWorkspaces((prev) =>
        prev.map((w) => (w.id === id ? data.workspace! : w))
      );
    }
    setRenamingId(null);
    setRenameValue("");
  }

  // ── Workspace delete ───────────────────────────────────────────────────────
  async function deleteWorkspace(id: number) {
    setError("");
    const res = await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) {
      setError(data.error ?? "Failed to delete workspace.");
      setDeletingId(null);
      return;
    }
    setWorkspaces((prev) => prev.filter((w) => w.id !== id));
    setDeletingId(null);
    // If we deleted the active workspace, switch to first remaining
    if (id === activeWorkspaceId) {
      const remaining = workspaces.filter((w) => w.id !== id);
      if (remaining.length > 0) switchToWorkspace(remaining[0].id);
    }
  }

  // ── Workspace translationOnly toggle ──────────────────────────────────────
  async function toggleTranslationOnly(id: number, value: boolean) {
    setWorkspaces((prev) => prev.map((w) => w.id === id ? { ...w, translationOnly: value } : w));
    await fetch(`/api/workspaces/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ translationOnly: value }),
    });
  }

  // ── Import submit ──────────────────────────────────────────────────────────

  /** Builds the {scope, dataTypes} pair shared by the check and real-import requests. */
  function buildImportRequest() {
    const scope =
      importForm.scopeType === "chapter"
        ? {
            type: "chapter" as const,
            book: importForm.book.trim(),
            chapter: importForm.chapter,
          }
        : { type: "passage" as const, passageId: importForm.passageId };
    const dataTypes = DATA_TYPE_KEYS.map((d) => d.key).filter(
      (key) => importForm.dataTypes[key]
    );
    return { scope, dataTypes };
  }

  async function runImport(
    overwrite?: Partial<Record<OverwritableDataType, OverwriteChoice>>
  ) {
    setImportLoading(true);
    try {
      const { scope, dataTypes } = buildImportRequest();
      const res = await fetch("/api/workspace-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceWorkspaceId: importForm.sourceWorkspaceId,
          scope,
          dataTypes,
          overwrite,
        }),
      });
      const data = (await res.json()) as
        | { ok: true; results: ImportResult }
        | { error: string };
      if (!res.ok) {
        setImportError("error" in data ? data.error : "Import failed.");
      } else if ("results" in data) {
        setImportResult(data.results);
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
    if (
      importForm.scopeType === "passage" &&
      (!importForm.passageId || importForm.passageId < 1)
    ) {
      setImportError("Please enter a valid passage ID.");
      return;
    }

    const { scope, dataTypes } = buildImportRequest();

    // Check whether the target workspace already has translation text or
    // clause/paragraph labels in this scope before importing — those would
    // otherwise just pile up as duplicate rows alongside the existing data.
    setImportChecking(true);
    try {
      const checkRes = await fetch("/api/workspace-import/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceWorkspaceId: importForm.sourceWorkspaceId,
          scope,
          dataTypes,
        }),
      });
      if (checkRes.ok) {
        const { conflicts } = (await checkRes.json()) as {
          conflicts: Partial<Record<OverwritableDataType, ConflictInfo>>;
        };
        const conflictingTypes = (Object.keys(conflicts) as OverwritableDataType[])
          .filter((k) => conflicts[k]?.exists);
        if (conflictingTypes.length > 0) {
          setImportConflicts(conflicts);
          setImportOverwriteChoices(
            Object.fromEntries(conflictingTypes.map((k) => [k, "skip"]))
          );
          return; // wait for the user to choose overwrite/skip and confirm
        }
      }
    } catch {
      // Non-blocking — if the check itself fails, fall through and let the
      // real import attempt run (it will surface its own error if needed).
    } finally {
      setImportChecking(false);
    }

    await runImport();
  }

  async function confirmImportWithChoices() {
    await runImport(importOverwriteChoices);
    setImportConflicts(null);
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        className="max-w-2xl mx-auto px-6 py-10 text-sm"
        style={mutedStyle}
      >
        {t("account.loading")}
      </div>
    );
  }

  const otherWorkspaces = workspaces.filter((w) => w.id !== activeWorkspaceId);

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="mb-8">
        <Link
          href="/"
          className="text-sm mb-4 inline-block transition-colors"
          style={mutedStyle}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLAnchorElement).style.color =
              "var(--foreground)")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLAnchorElement).style.color =
              "var(--text-muted)")
          }
        >
          {t("account.backLink")}
        </Link>
        <h1 className="text-3xl font-bold mt-2" style={fgStyle}>
          {t("account.title")}
        </h1>
        <p className="mt-2 text-sm" style={mutedStyle}>
          {t("account.description")}
        </p>
      </header>

      {/* Global error banner */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {/* ── Section 1: Your Account ─────────────────────────────────────────── */}
      <section className="rounded-xl p-6 mb-6" style={sectionStyle}>
        <h2 className="text-base font-semibold mb-4" style={fgStyle}>
          {t("account.yourAccount")}
        </h2>

        {!user ? (
          <p className="text-sm" style={mutedStyle}>
            {t("account.noUser")}
          </p>
        ) : editingUser ? (
          <div className="space-y-3">
            <p className="text-xs" style={mutedStyle}>Name and email are optional and stored only on this device.</p>
            <div>
              <label className="block text-xs font-medium mb-1" style={mutedStyle}>
                {t("account.name")} <span className="font-normal italic">— optional</span>
              </label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg text-sm"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={mutedStyle}>
                {t("account.email")} <span className="font-normal italic">— optional</span>
              </label>
              <input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg text-sm"
                style={inputStyle}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <BtnPrimary onClick={saveUser}>{t("account.save")}</BtnPrimary>
              <BtnNeutral
                onClick={() => {
                  setEditingUser(false);
                  setEditName(user.name);
                  setEditEmail(user.email);
                  setError("");
                }}
              >
                {t("account.cancel")}
              </BtnNeutral>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium" style={fgStyle}>
                {user.name}
              </p>
              <p className="text-sm" style={mutedStyle}>
                {user.email}
              </p>
            </div>
            <BtnNeutral onClick={() => setEditingUser(true)}>{t("account.edit")}</BtnNeutral>
          </div>
        )}
      </section>

      {/* ── Section 2: Workspaces ───────────────────────────────────────────── */}
      <section className="rounded-xl p-6 mb-6" style={sectionStyle}>
        <h2 className="text-base font-semibold mb-4" style={fgStyle}>
          {t("account.workspaces")}
        </h2>

        <div className="space-y-2">
          {workspaces.map((ws) => {
            const isActive = ws.id === activeWorkspaceId;
            const isDeleting = deletingId === ws.id;
            const isRenaming = renamingId === ws.id;
            const isOnlyOne = workspaces.length <= 1;

            return (
              <div
                key={ws.id}
                className="flex items-center gap-2 rounded-lg px-3 py-2.5"
                style={{
                  backgroundColor: isActive
                    ? "var(--surface-muted)"
                    : "transparent",
                  border: "1px solid var(--border)",
                }}
              >
                {/* Name / rename input */}
                <div className="flex-1 min-w-0">
                  {isRenaming ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") renameWorkspace(ws.id);
                          if (e.key === "Escape") {
                            setRenamingId(null);
                            setRenameValue("");
                          }
                        }}
                        autoFocus
                        className="px-2 py-1 rounded-md text-sm flex-1"
                        style={inputStyle}
                      />
                      <BtnPrimary onClick={() => renameWorkspace(ws.id)}>
                        {t("account.save")}
                      </BtnPrimary>
                      <BtnNeutral
                        onClick={() => {
                          setRenamingId(null);
                          setRenameValue("");
                        }}
                      >
                        {t("account.cancel")}
                      </BtnNeutral>
                    </div>
                  ) : (
                    <div>
                      <span
                        className={`text-sm ${isActive ? "font-semibold" : "font-normal"}`}
                        style={fgStyle}
                      >
                        {ws.name}
                      </span>
                      <label className="flex items-center gap-1.5 mt-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={ws.translationOnly}
                          onChange={(e) => toggleTranslationOnly(ws.id, e.target.checked)}
                          className="accent-[var(--accent)]"
                        />
                        <span className="text-xs" style={mutedStyle}>Translation text only</span>
                      </label>
                    </div>
                  )}
                </div>

                {/* Badges & actions */}
                {!isRenaming && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isActive && (
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{
                          backgroundColor: "var(--accent)",
                          color: "#fff",
                        }}
                      >
                        {t("account.active")}
                      </span>
                    )}

                    {!isActive && (
                      <BtnNeutral onClick={() => switchToWorkspace(ws.id)}>
                        {t("account.switch")}
                      </BtnNeutral>
                    )}

                    <BtnNeutral
                      onClick={() => {
                        setRenamingId(ws.id);
                        setRenameValue(ws.name);
                        setDeletingId(null);
                      }}
                    >
                      {t("account.rename")}
                    </BtnNeutral>

                    {isDeleting ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-red-600 dark:text-red-400">
                          {t("account.deleteConfirm")}
                        </span>
                        <BtnDanger onClick={() => deleteWorkspace(ws.id)}>
                          {t("account.confirm")}
                        </BtnDanger>
                        <BtnNeutral onClick={() => setDeletingId(null)}>
                          {t("account.cancel")}
                        </BtnNeutral>
                      </div>
                    ) : (
                      <BtnNeutral
                        onClick={() => {
                          if (!isOnlyOne) {
                            setDeletingId(ws.id);
                            setRenamingId(null);
                          }
                        }}
                        disabled={isOnlyOne}
                        title={
                          isOnlyOne
                            ? t("account.cannotDeleteLast")
                            : undefined
                        }
                      >
                        {t("account.delete")}
                      </BtnNeutral>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* New workspace form */}
        <div className="mt-4">
          {showNewWorkspaceForm ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder={t("account.workspacePlaceholder")}
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createWorkspace();
                  if (e.key === "Escape") {
                    setShowNewWorkspaceForm(false);
                    setNewWorkspaceName("");
                  }
                }}
                autoFocus
                className="px-3 py-1.5 rounded-lg text-sm flex-1"
                style={inputStyle}
              />
              <BtnPrimary onClick={createWorkspace}>{t("account.create")}</BtnPrimary>
              <BtnNeutral
                onClick={() => {
                  setShowNewWorkspaceForm(false);
                  setNewWorkspaceName("");
                }}
              >
                {t("account.cancel")}
              </BtnNeutral>
            </div>
          ) : (
            <BtnNeutral onClick={() => setShowNewWorkspaceForm(true)}>
              {t("account.newWorkspace")}
            </BtnNeutral>
          )}
        </div>
      </section>

      {/* ── Section 3: Import from Another Workspace ────────────────────────── */}
      {workspaces.length >= 2 && (
        <section className="rounded-xl p-6 mb-6" style={sectionStyle}>
          <h2 className="text-base font-semibold mb-1" style={fgStyle}>
            {t("account.importTitle")}
          </h2>
          <p className="text-sm mb-5" style={mutedStyle}>
            {t("account.importDesc")}
          </p>

          <div className="space-y-4">
            {/* Source workspace */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={mutedStyle}>
                {t("account.sourceWorkspace")}
              </label>
              <select
                value={importForm.sourceWorkspaceId}
                onChange={(e) =>
                  setImportForm((f) => ({
                    ...f,
                    sourceWorkspaceId: parseInt(e.target.value, 10),
                    passageId: 0,
                  }))
                }
                className="px-3 py-1.5 rounded-lg text-sm"
                style={inputStyle}
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
              <label className="block text-xs font-medium mb-1.5" style={mutedStyle}>
                {t("account.scope")}
              </label>
              <div className="flex gap-4">
                {(["chapter", "passage"] as const).map((type) => (
                  <label
                    key={type}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                    style={fgStyle}
                  >
                    <input
                      type="radio"
                      name="scopeType"
                      value={type}
                      checked={importForm.scopeType === type}
                      onChange={() =>
                        setImportForm((f) => ({ ...f, scopeType: type }))
                      }
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
                  <label
                    className="block text-xs font-medium mb-1.5"
                    style={mutedStyle}
                  >
                    {t("account.bookLabel")}
                  </label>
                  <select
                    value={importForm.book}
                    onChange={(e) =>
                      setImportForm((f) => ({ ...f, book: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 rounded-lg text-sm"
                    style={inputStyle}
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
                  <label
                    className="block text-xs font-medium mb-1.5"
                    style={mutedStyle}
                  >
                    {t("account.chapterLabel")}
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={importForm.chapter}
                    onChange={(e) =>
                      setImportForm((f) => ({
                        ...f,
                        chapter: parseInt(e.target.value, 10) || 1,
                      }))
                    }
                    className="w-24 px-3 py-1.5 rounded-lg text-sm"
                    style={inputStyle}
                  />
                </div>
              </div>
            ) : (
              <div>
                <label
                  className="block text-xs font-medium mb-1.5"
                  style={mutedStyle}
                >
                  {t("account.passageIdLabel")}
                </label>
                <input
                  type="number"
                  min={1}
                  placeholder={t("account.passageIdPlaceholder")}
                  value={importForm.passageId || ""}
                  onChange={(e) =>
                    setImportForm((f) => ({
                      ...f,
                      passageId: parseInt(e.target.value, 10) || 0,
                    }))
                  }
                  className="w-40 px-3 py-1.5 rounded-lg text-sm"
                  style={inputStyle}
                />
                <p className="text-xs mt-1.5" style={mutedStyle}>
                  {t("account.passageIdHelp")}
                </p>
              </div>
            )}

            {/* Data types */}
            <div>
              <label className="block text-xs font-medium mb-2" style={mutedStyle}>
                {t("account.dataToImport")}
              </label>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {DATA_TYPE_KEYS.map(({ key, tKey }) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                    style={fgStyle}
                  >
                    <input
                      type="checkbox"
                      checked={importForm.dataTypes[key]}
                      onChange={(e) =>
                        setImportForm((f) => ({
                          ...f,
                          dataTypes: {
                            ...f.dataTypes,
                            [key]: e.target.checked,
                          },
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
                  style={mutedStyle}
                  onClick={() =>
                    setImportForm((f) => ({
                      ...f,
                      dataTypes: Object.fromEntries(
                        DATA_TYPE_KEYS.map(({ key }) => [key, true])
                      ) as ImportForm["dataTypes"],
                    }))
                  }
                >
                  {t("account.selectAll")}
                </button>
                <button
                  className="text-xs underline-offset-2 hover:underline"
                  style={mutedStyle}
                  onClick={() =>
                    setImportForm((f) => ({
                      ...f,
                      dataTypes: Object.fromEntries(
                        DATA_TYPE_KEYS.map(({ key }) => [key, false])
                      ) as ImportForm["dataTypes"],
                    }))
                  }
                >
                  {t("account.deselectAll")}
                </button>
              </div>
            </div>

            {/* Overwrite/skip conflict resolution — shown when the check finds
                pre-existing translation text or clause/paragraph labels in scope */}
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
                  <BtnPrimary
                    onClick={confirmImportWithChoices}
                    disabled={importLoading}
                    className="px-4 py-2"
                  >
                    {importLoading ? t("account.importing") : t("account.importContinue")}
                  </BtnPrimary>
                  <BtnNeutral onClick={() => setImportConflicts(null)} disabled={importLoading}>
                    {t("account.cancel")}
                  </BtnNeutral>
                </div>
              </div>
            ) : (
              /* Import button */
              <div className="flex items-center gap-3 pt-1">
                <BtnPrimary
                  onClick={submitImport}
                  disabled={importLoading || importChecking}
                  className="px-4 py-2"
                >
                  {importLoading
                    ? t("account.importing")
                    : importChecking
                    ? t("account.importChecking")
                    : t("account.import")}
                </BtnPrimary>
                {(importLoading || importChecking) && (
                  <span className="text-xs" style={mutedStyle}>
                    {t("account.importingMoment")}
                  </span>
                )}
              </div>
            )}

            {/* Import error */}
            {importError && (
              <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
                {importError}
              </div>
            )}

            {/* Import result */}
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
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
