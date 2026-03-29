"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
    lineAnnotations: boolean;
    wordTags: boolean;
    wordFormatting: boolean;
    characters: boolean;
    lineIndents: boolean;
    wordArrows: boolean;
    clauseRelationships: boolean;
    rstRelations: boolean;
    notes: boolean;
    passages: boolean;
  };
}

interface ImportResult {
  [key: string]: { imported: number };
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
    lineAnnotations: true,
    wordTags: true,
    wordFormatting: true,
    characters: true,
    lineIndents: true,
    wordArrows: true,
    clauseRelationships: true,
    rstRelations: true,
    notes: true,
    passages: true,
  },
};

const DATA_TYPE_LABELS: { key: keyof ImportForm["dataTypes"]; label: string }[] =
  [
    { key: "translationVerses", label: "Translation text" },
    { key: "sectionBreaks", label: "Section breaks" },
    { key: "lineAnnotations", label: "Line annotations" },
    { key: "wordTags", label: "Word tags & refs" },
    { key: "wordFormatting", label: "Word formatting" },
    { key: "characters", label: "Characters & speech" },
    { key: "lineIndents", label: "Line indents" },
    { key: "wordArrows", label: "Word arrows" },
    { key: "clauseRelationships", label: "Clause relationships" },
    { key: "rstRelations", label: "RST relations" },
    { key: "notes", label: "Notes" },
    { key: "passages", label: "Passages" },
  ];

// ── Main component ───────────────────────────────────────────────────────────

export default function AccountPanel({ activeWorkspaceId: initialActiveId }: Props) {
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

  // ── Import submit ──────────────────────────────────────────────────────────
  async function submitImport() {
    setImportError("");
    setImportResult(null);
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

    setImportLoading(true);
    try {
      const res = await fetch("/api/workspace-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetWorkspaceId: activeWorkspaceId,
          ...importForm,
        }),
      });
      const data = (await res.json()) as
        | { result: ImportResult }
        | { error: string };
      if (!res.ok) {
        setImportError("error" in data ? data.error : "Import failed.");
      } else if ("result" in data) {
        setImportResult(data.result);
      }
    } catch {
      setImportError("Network error — could not reach the server.");
    } finally {
      setImportLoading(false);
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        className="max-w-2xl mx-auto px-6 py-10 text-sm"
        style={mutedStyle}
      >
        Loading…
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
          ← Back to Structura
        </Link>
        <h1 className="text-3xl font-bold mt-2" style={fgStyle}>
          Account &amp; Workspaces
        </h1>
        <p className="mt-2 text-sm" style={mutedStyle}>
          Manage your profile and workspaces, or import data between workspaces.
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
          Your Account
        </h2>

        {!user ? (
          <p className="text-sm" style={mutedStyle}>
            No user account found.
          </p>
        ) : editingUser ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={mutedStyle}>
                Name
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
                Email
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
              <BtnPrimary onClick={saveUser}>Save</BtnPrimary>
              <BtnNeutral
                onClick={() => {
                  setEditingUser(false);
                  setEditName(user.name);
                  setEditEmail(user.email);
                  setError("");
                }}
              >
                Cancel
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
            <BtnNeutral onClick={() => setEditingUser(true)}>Edit</BtnNeutral>
          </div>
        )}
      </section>

      {/* ── Section 2: Workspaces ───────────────────────────────────────────── */}
      <section className="rounded-xl p-6 mb-6" style={sectionStyle}>
        <h2 className="text-base font-semibold mb-4" style={fgStyle}>
          Workspaces
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
                        Save
                      </BtnPrimary>
                      <BtnNeutral
                        onClick={() => {
                          setRenamingId(null);
                          setRenameValue("");
                        }}
                      >
                        Cancel
                      </BtnNeutral>
                    </div>
                  ) : (
                    <span
                      className={`text-sm ${isActive ? "font-semibold" : "font-normal"}`}
                      style={fgStyle}
                    >
                      {ws.name}
                    </span>
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
                        Active
                      </span>
                    )}

                    {!isActive && (
                      <BtnNeutral onClick={() => switchToWorkspace(ws.id)}>
                        Switch
                      </BtnNeutral>
                    )}

                    <BtnNeutral
                      onClick={() => {
                        setRenamingId(ws.id);
                        setRenameValue(ws.name);
                        setDeletingId(null);
                      }}
                    >
                      Rename
                    </BtnNeutral>

                    {isDeleting ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-red-600 dark:text-red-400">
                          Delete?
                        </span>
                        <BtnDanger onClick={() => deleteWorkspace(ws.id)}>
                          Confirm
                        </BtnDanger>
                        <BtnNeutral onClick={() => setDeletingId(null)}>
                          Cancel
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
                            ? "Cannot delete the last workspace"
                            : undefined
                        }
                      >
                        Delete
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
                placeholder="Workspace name"
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
              <BtnPrimary onClick={createWorkspace}>Create</BtnPrimary>
              <BtnNeutral
                onClick={() => {
                  setShowNewWorkspaceForm(false);
                  setNewWorkspaceName("");
                }}
              >
                Cancel
              </BtnNeutral>
            </div>
          ) : (
            <BtnNeutral onClick={() => setShowNewWorkspaceForm(true)}>
              + New Workspace
            </BtnNeutral>
          )}
        </div>
      </section>

      {/* ── Section 3: Import from Another Workspace ────────────────────────── */}
      {workspaces.length >= 2 && (
        <section className="rounded-xl p-6 mb-6" style={sectionStyle}>
          <h2 className="text-base font-semibold mb-1" style={fgStyle}>
            Import Data from Another Workspace
          </h2>
          <p className="text-sm mb-5" style={mutedStyle}>
            Copy annotations and data from a source workspace into the active
            workspace for a specific chapter or passage.
          </p>

          <div className="space-y-4">
            {/* Source workspace */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={mutedStyle}>
                Source workspace
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
                <option value={0}>— select a workspace —</option>
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
                Scope
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
                    {type === "chapter" ? "Chapter" : "Passage"}
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
                    Book (e.g. Gen, Matt)
                  </label>
                  <input
                    type="text"
                    placeholder="Gen"
                    value={importForm.book}
                    onChange={(e) =>
                      setImportForm((f) => ({ ...f, book: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 rounded-lg text-sm"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label
                    className="block text-xs font-medium mb-1.5"
                    style={mutedStyle}
                  >
                    Chapter
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
                  Passage ID
                </label>
                <input
                  type="number"
                  min={1}
                  placeholder="e.g. 42"
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
                  Find the passage ID from the source workspace&apos;s passages panel.
                </p>
              </div>
            )}

            {/* Data types */}
            <div>
              <label className="block text-xs font-medium mb-2" style={mutedStyle}>
                Data to import
              </label>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {DATA_TYPE_LABELS.map(({ key, label }) => (
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
                    {label}
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
                        DATA_TYPE_LABELS.map(({ key }) => [key, true])
                      ) as ImportForm["dataTypes"],
                    }))
                  }
                >
                  Select all
                </button>
                <button
                  className="text-xs underline-offset-2 hover:underline"
                  style={mutedStyle}
                  onClick={() =>
                    setImportForm((f) => ({
                      ...f,
                      dataTypes: Object.fromEntries(
                        DATA_TYPE_LABELS.map(({ key }) => [key, false])
                      ) as ImportForm["dataTypes"],
                    }))
                  }
                >
                  Deselect all
                </button>
              </div>
            </div>

            {/* Import button */}
            <div className="flex items-center gap-3 pt-1">
              <BtnPrimary
                onClick={submitImport}
                disabled={importLoading}
                className="px-4 py-2"
              >
                {importLoading ? "Importing…" : "Import"}
              </BtnPrimary>
              {importLoading && (
                <span className="text-xs" style={mutedStyle}>
                  This may take a moment…
                </span>
              )}
            </div>

            {/* Import error */}
            {importError && (
              <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
                {importError}
              </div>
            )}

            {/* Import result */}
            {importResult && (
              <div className="rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
                <p className="font-medium mb-2">Import complete.</p>
                <ul className="space-y-0.5 text-xs font-mono opacity-80">
                  {Object.entries(importResult)
                    .filter(([, v]) => v.imported > 0)
                    .map(([key, v]) => (
                      <li key={key}>
                        {key}: {v.imported.toLocaleString()} imported
                      </li>
                    ))}
                  {Object.values(importResult).every((v) => v.imported === 0) && (
                    <li>Nothing to import for the given scope and selection.</li>
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
