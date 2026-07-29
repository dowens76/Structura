"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import DefineSynopticSetDialog from "@/components/synoptic/DefineSynopticSetDialog";
import ThemeToggle from "@/components/ThemeToggle";
import SettingsButton from "@/components/SettingsButton";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import type { SynopticSetWithColumns } from "@/lib/db/queries";

export default function SynopticDetailNav({
  set,
  workspaceId,
}: {
  set: SynopticSetWithColumns;
  workspaceId: number;
}) {
  const router = useRouter();
  const [showEdit, setShowEdit] = useState(false);

  async function handleDelete() {
    if (!confirm(`Delete "${set.title}"? The underlying passages and any annotations you've made stay intact.`)) return;
    await fetch(`/api/synoptic-sets/${set.id}`, { method: "DELETE" });
    router.push("/synoptic");
  }

  return (
    <nav
      className="shrink-0 border-b px-4 py-0 flex items-center gap-3 h-12"
      style={{ borderColor: "var(--nav-border)", backgroundColor: "var(--nav-bg)" }}
    >
      <Link href="/" className="shrink-0 flex items-center" aria-label="Structura home">
        <Image
          src="/structura-icon.svg"
          alt="Structura"
          width={28}
          height={28}
          className="opacity-90"
          style={{ filter: "brightness(0) invert(1)" }}
        />
      </Link>

      <span style={{ color: "var(--nav-border)" }} className="text-lg select-none">|</span>

      <Link
        href="/synoptic"
        className="text-xs px-2 py-1 rounded transition-colors"
        style={{ color: "var(--nav-fg)" }}
      >
        ← Synoptic Sets
      </Link>

      <span className="text-sm font-semibold truncate" style={{ color: "var(--nav-fg-muted)" }}>
        {set.title}
      </span>

      <button
        type="button"
        onClick={() => setShowEdit(true)}
        className="text-xs px-2 py-1 rounded border transition-colors"
        style={{ borderColor: "var(--border)", color: "var(--nav-fg)" }}
      >
        Edit Scope
      </button>
      <button
        type="button"
        onClick={handleDelete}
        className="text-xs px-2 py-1 rounded transition-colors hover:text-red-500"
        style={{ color: "var(--nav-fg-muted)" }}
      >
        Delete
      </button>

      <div className="ml-auto flex items-center gap-1">
        <WorkspaceSwitcher activeWorkspaceId={workspaceId} />
        <SettingsButton />
        <ThemeToggle />
      </div>

      {showEdit && (
        <DefineSynopticSetDialog
          existingSet={set}
          onClose={() => setShowEdit(false)}
          onSaved={() => router.refresh()}
        />
      )}
    </nav>
  );
}
