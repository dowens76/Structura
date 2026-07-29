"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { SynopticCategoryType } from "@/lib/db/schema";

// Module-level cache + useSyncExternalStore, same pattern as
// useCommFunctionCustoms in components/text/CommunicativeFunctionPicker.tsx —
// keeps every consumer (annotation editor, category manager modal) in sync
// without prop-drilling or a React Context.
let cache: SynopticCategoryType[] = [];
let fetched = false;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function ensureFetched() {
  if (fetched) return;
  fetched = true;
  fetch("/api/synoptic-category-types")
    .then((r) => (r.ok ? r.json() : []))
    .then((rows: SynopticCategoryType[]) => {
      cache = rows;
      notify();
    })
    .catch(() => { /* leave cache empty — picker just shows nothing until retried */ });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function getSnapshot() { return cache; }
const EMPTY: SynopticCategoryType[] = [];
function getServerSnapshot() { return EMPTY; }

export function useSynopticCategories() {
  ensureFetched();
  const categories = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/synoptic-category-types");
    cache = r.ok ? await r.json() : [];
    notify();
  }, []);

  const addCategory = useCallback(async (label: string, color: string) => {
    const r = await fetch("/api/synoptic-category-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, color }),
    });
    if (!r.ok) throw new Error("Failed to add — please try again.");
    const row = await r.json();
    cache = [...cache, row];
    notify();
    return row as SynopticCategoryType;
  }, []);

  const updateCategory = useCallback(async (id: number, updates: { label?: string; color?: string }) => {
    const r = await fetch("/api/synoptic-category-types", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
    if (!r.ok) throw new Error("Failed to save — please try again.");
    const row = await r.json();
    cache = cache.map((c) => (c.id === id ? row : c));
    notify();
  }, []);

  const deleteCategory = useCallback(async (id: number) => {
    const r = await fetch(`/api/synoptic-category-types?id=${id}`, { method: "DELETE" });
    if (!r.ok) throw new Error("Failed to delete — please try again.");
    cache = cache.filter((c) => c.id !== id);
    notify();
  }, []);

  /** Persists a full reordering (array of ids in their new display order). */
  const reorderCategories = useCallback(async (orderedIds: number[]) => {
    const prev = cache;
    cache = orderedIds.map((id, i) => {
      const c = prev.find((x) => x.id === id)!;
      return { ...c, sortOrder: i };
    });
    notify();
    try {
      const r = await fetch("/api/synoptic-category-types/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: orderedIds.map((id, i) => ({ id, sortOrder: i })) }),
      });
      if (!r.ok) throw new Error();
    } catch {
      cache = prev;
      notify();
      throw new Error("Failed to save order — please try again.");
    }
  }, []);

  return { categories, refresh, addCategory, updateCategory, deleteCategory, reorderCategories };
}

/** Resolve a synoptic annotation's stored category `key` to its live display
 *  label/color — falls back to the raw key if the category was since deleted. */
export function getSynopticCategoryDisplay(
  key: string,
  categories: SynopticCategoryType[]
): { label: string; color: string | null } {
  const found = categories.find((c) => c.key === key);
  return { label: found?.label ?? key, color: found?.color ?? null };
}
