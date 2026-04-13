"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "@/lib/i18n/LocaleContext";

interface Workspace {
  id: number;
  name: string;
}

interface Props {
  activeWorkspaceId: number;
}

export default function WorkspaceSwitcher({ activeWorkspaceId }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Fetch workspaces for the first user (single-user app)
  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then(async (data) => {
        if (data.users?.length) {
          const userId = data.users[0].id;
          const r2 = await fetch(`/api/workspaces?userId=${userId}`);
          const d2 = await r2.json();
          setWorkspaces(d2.workspaces ?? []);
        }
      })
      .catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function switchWorkspace(id: number) {
    document.cookie = `structura_active_workspace=${id}; path=/; SameSite=Lax`;
    setOpen(false);
    router.refresh();
  }

  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  const label = active?.name ?? t("nav.workspace");

  if (workspaces.length === 0) return null;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors"
        style={{ color: "var(--nav-fg)", backgroundColor: open ? "var(--surface)" : "transparent" }}
        title={t("nav.titleSwitchWorkspace")}
      >
        <span className="max-w-[100px] truncate">{label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-48 rounded-lg shadow-lg z-50 py-1"
          style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            {t("nav.workspacesHeading")}
          </div>
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              type="button"
              onClick={() => switchWorkspace(ws.id)}
              className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
              style={{ color: "var(--foreground)" }}
            >
              {ws.id === activeWorkspaceId && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="shrink-0">
                  <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
              {ws.id !== activeWorkspaceId && <span className="w-3 shrink-0" />}
              <span className="truncate">{ws.name}</span>
            </button>
          ))}
          <div className="border-t mt-1 pt-1" style={{ borderColor: "var(--border)" }}>
            <Link
              href="/account"
              className="block px-3 py-1.5 text-sm hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
              style={{ color: "var(--text-muted)" }}
              onClick={() => setOpen(false)}
            >
              {t("nav.manageWorkspaces")}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
