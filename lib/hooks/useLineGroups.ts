"use client";
import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { LineGroup } from "@/lib/db/schema";
import { buildLineGroupTree, type LineGroupNode } from "@/lib/lineGroups/buildLineGroupTree";
import { defaultColorForLevel, MAX_CONFIGURABLE_LEVELS } from "@/lib/lineGroups/colors";

// ── localStorage helpers (scoped to line-group settings) ──────────────────────
function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function writeLocal<T>(key: string, value: T): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

export interface UseLineGroupsOptions {
  initialLineGroups: LineGroup[];
  book: string;
  textSource: string;
  /** Resolves a wordId (or groupId) to its chapter number for API calls. */
  getChapterForWord: (wordId: string) => number;
  /** Ordered wordIds of every line in the current view — needed to decide
   *  whether a new member should flatten into an existing group (adjacent
   *  line) or create a new nesting group (non-adjacent, or two groups). */
  paragraphFirstWordIds: string[];
}

export interface UseLineGroupsReturn {
  lineGroups: LineGroup[];
  setLineGroups: Dispatch<SetStateAction<LineGroup[]>>;
  editingLineGroups: boolean;
  setEditingLineGroups: Dispatch<SetStateAction<boolean>>;
  lineGroupSegA: string | null;
  setLineGroupSegA: Dispatch<SetStateAction<string | null>>;
  /** Set when segA was chosen by clicking an existing bracket's connector dot
   *  (rather than a line) — mirrors RST's selectedNucleusGroupId. */
  lineGroupSegAGroupId: string | null;
  setLineGroupSegAGroupId: Dispatch<SetStateAction<string | null>>;
  /** Resolves the bracket color for a given nesting level (1-indexed; level 1
   *  = innermost, groups of plain lines). Levels beyond what's configured
   *  cycle back through the configured/default colors. */
  getBracketColor: (level: number) => string;
  setBracketColorForLevel: (level: number, color: string) => void;
  handleSelectLineGroupSegment: (wordId: string) => Promise<void>;
  handleSelectLineGroupGroup: (groupId: string) => Promise<void>;
  handleDeleteLineGroup: (groupId: string) => Promise<void>;
}

function getGroupSpan(
  groupId: string,
  tree: LineGroupNode,
  orderedIds: string[],
): { minIdx: number; maxIdx: number } | null {
  function find(node: LineGroupNode): LineGroupNode | null {
    if (node.id === groupId && node.type === "group") return node;
    for (const ch of node.children ?? []) {
      const r = find(ch);
      if (r) return r;
    }
    return null;
  }
  const node = find(tree);
  if (!node) return null;

  const leafIds: string[] = [];
  function collect(n: LineGroupNode) {
    if (n.type === "segment") { leafIds.push(n.id); return; }
    for (const ch of n.children ?? []) collect(ch);
  }
  collect(node);

  const idxs = leafIds.map(id => orderedIds.indexOf(id)).filter(i => i !== -1);
  if (!idxs.length) return null;
  return { minIdx: Math.min(...idxs), maxIdx: Math.max(...idxs) };
}

/**
 * Finds the innermost group that directly (flatly) contains `leafId` as one
 * of its own members — as opposed to a group `leafId` belongs to only
 * transitively through a nested sub-group.
 */
function findImmediateGroupParent(leafId: string, node: LineGroupNode): LineGroupNode | null {
  if (node.type === "group") {
    for (const ch of node.children ?? []) {
      if (ch.type === "segment" && ch.id === leafId) return node;
    }
  }
  for (const ch of node.children ?? []) {
    const r = findImmediateGroupParent(leafId, ch);
    if (r) return r;
  }
  return null;
}

/**
 * Resolves a raw click endpoint to what it should behave as for grouping
 * purposes: if the user clicked a plain line that already belongs to a
 * group, treat it exactly as if they had clicked that group's connector dot
 * instead — this is what lets three consecutive lines merge into a single
 * flat bracket instead of two overlapping ones that both touch the shared
 * middle line.
 */
function resolveEndpoint(
  id: string,
  isGroup: boolean,
  tree: LineGroupNode,
): { id: string; isGroup: boolean } {
  if (isGroup) return { id, isGroup };
  const parent = findImmediateGroupParent(id, tree);
  return parent ? { id: parent.id, isGroup: true } : { id, isGroup };
}

export function useLineGroups({
  initialLineGroups,
  book,
  textSource,
  getChapterForWord,
  paragraphFirstWordIds,
}: UseLineGroupsOptions): UseLineGroupsReturn {
  const [lineGroups, setLineGroups] = useState<LineGroup[]>(initialLineGroups);
  const [editingLineGroups, setEditingLineGroups] = useState(false);
  const [lineGroupSegA, setLineGroupSegA] = useState<string | null>(null);
  const [lineGroupSegAGroupId, setLineGroupSegAGroupId] = useState<string | null>(null);
  const [bracketColors, setBracketColorsState] = useState<string[]>(
    () => readLocal<string[]>("structura:lineGroupColors", [])
  );

  // Levels beyond MAX_CONFIGURABLE_LEVELS cycle back through the configured
  // ones — cycle the LEVEL NUMBER itself (mod the fixed cap) before lookup,
  // rather than the stored array's current length, so an array that only
  // has level 1 explicitly set doesn't cause level 2+ to wrongly wrap back
  // to level 1's color instead of falling through to its own default.
  function effectiveLevel(level: number): number {
    return ((level - 1) % MAX_CONFIGURABLE_LEVELS) + 1;
  }

  function getBracketColor(level: number): string {
    const lvl = effectiveLevel(level);
    return bracketColors[lvl - 1] ?? defaultColorForLevel(lvl);
  }

  function setBracketColorForLevel(level: number, color: string) {
    const lvl = effectiveLevel(level);
    setBracketColorsState((prev) => {
      const next = [...prev];
      while (next.length < lvl) {
        next.push(defaultColorForLevel(next.length + 1));
      }
      next[lvl - 1] = color;
      writeLocal("structura:lineGroupColors", next);
      return next;
    });
  }

  async function commitPair(rawAId: string, rawAIsGroup: boolean, rawBId: string, rawBIsGroup: boolean) {
    const tree = buildLineGroupTree(lineGroups, paragraphFirstWordIds);

    // Resolve each endpoint: a plain line that's already inside a group
    // behaves exactly as if the user had clicked that group's connector dot.
    // This is what lets three consecutive lines merge into ONE flat bracket
    // (e.g. clicking already-grouped 1c, then adjacent 1d, extends the
    // existing {1b,1c} group to {1b,1c,1d}) instead of creating a second,
    // overlapping 2-member bracket that duplicates the shared line.
    const { id: aId, isGroup: aIsGroup } = resolveEndpoint(rawAId, rawAIsGroup, tree);
    const { id: bId, isGroup: bIsGroup } = resolveEndpoint(rawBId, rawBIsGroup, tree);

    // Guard: both endpoints resolved to the same group (e.g. two lines
    // already inside the same group) — nothing meaningful to do.
    if (aIsGroup && bIsGroup && aId === bId) return;

    const ch = getChapterForWord(aId);

    // Flat-extend: exactly one endpoint is an existing group and the other is
    // a plain line immediately adjacent to that group's span — add it as a
    // direct (flat) member rather than nesting a new wrapper group.
    if (aIsGroup !== bIsGroup) {
      const groupId = aIsGroup ? aId : bId;
      const lineId  = aIsGroup ? bId : aId;
      const span = getGroupSpan(groupId, tree, paragraphFirstWordIds);
      const lineIdx = paragraphFirstWordIds.indexOf(lineId);
      if (span && lineIdx !== -1 && (lineIdx === span.minIdx - 1 || lineIdx === span.maxIdx + 1)) {
        const existing = lineGroups.filter(r => r.groupId === groupId);
        const orders = existing.map(r => r.sortOrder);
        const sortOrder = lineIdx < span.minIdx
          ? Math.min(...orders) - 1
          : Math.max(...orders) + 1;
        const resp = await fetch("/api/line-groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            groupId,
            members: [{ memberId: lineId, sortOrder }],
            book, chapter: ch, source: textSource,
          }),
        });
        const { lineGroups: newRows } = await resp.json();
        setLineGroups(prev => [...prev, ...newRows]);
        return;
      }
    }

    // Otherwise: create a brand-new group wrapping both endpoints (nesting
    // whichever endpoints are themselves existing groups).
    const groupId = crypto.randomUUID();
    const members = [
      { memberId: aId, sortOrder: 0 },
      { memberId: bId, sortOrder: 1 },
    ];
    const resp = await fetch("/api/line-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId, members, book, chapter: ch, source: textSource }),
    });
    const { lineGroups: newRows } = await resp.json();
    setLineGroups(prev => [...prev, ...newRows]);
  }

  async function handleSelectLineGroupSegment(wordId: string) {
    if (!lineGroupSegA) {
      setLineGroupSegA(wordId);
      setLineGroupSegAGroupId(null);
      return;
    }
    if (wordId === lineGroupSegA) {
      setLineGroupSegA(null);
      setLineGroupSegAGroupId(null);
      return;
    }
    const aIsGroup = !!lineGroupSegAGroupId;
    const a = lineGroupSegA;
    setLineGroupSegA(null);
    setLineGroupSegAGroupId(null);
    await commitPair(a, aIsGroup, wordId, false);
  }

  async function handleSelectLineGroupGroup(groupId: string) {
    if (!lineGroupSegA) {
      setLineGroupSegA(groupId);
      setLineGroupSegAGroupId(groupId);
      return;
    }
    if (lineGroupSegA === groupId) {
      setLineGroupSegA(null);
      setLineGroupSegAGroupId(null);
      return;
    }
    const aIsGroup = !!lineGroupSegAGroupId;
    const a = lineGroupSegA;
    setLineGroupSegA(null);
    setLineGroupSegAGroupId(null);
    await commitPair(a, aIsGroup, groupId, true);
  }

  async function handleDeleteLineGroup(groupId: string) {
    await fetch("/api/line-groups", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId }),
    });
    setLineGroups(prev => prev.filter(r => r.groupId !== groupId));
  }

  return {
    lineGroups,
    setLineGroups,
    editingLineGroups,
    setEditingLineGroups,
    lineGroupSegA,
    setLineGroupSegA,
    lineGroupSegAGroupId,
    setLineGroupSegAGroupId,
    getBracketColor,
    setBracketColorForLevel,
    handleSelectLineGroupSegment,
    handleSelectLineGroupGroup,
    handleDeleteLineGroup,
  };
}
