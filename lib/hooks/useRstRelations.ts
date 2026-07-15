"use client";
import { useState, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { RstRelation, RstCustomType } from "@/lib/db/schema";
import { RELATIONSHIP_MAP } from "@/lib/morphology/clauseRelationships";

// ── localStorage helpers (scoped to RST linked setting) ───────────────────────
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

export interface UseRstRelationsOptions {
  initialRstRelations: RstRelation[];
  /** Only used when supportsLinkedTrees = true. */
  initialTvRstRelations?: RstRelation[];
  book: string;
  textSource: string;
  /**
   * Resolves a segWordId (or groupId) to the chapter number for API calls —
   * built from a wordId → chapter map so it stays correct across a
   * multi-chapter passage, not just a single chapter.
   */
  getChapterForWord: (wordId: string) => number;
  /**
   * When true, the hook manages a parallel tv-side relation list and a
   * linked/unlinked toggle. When false, only the source relations are managed.
   */
  supportsLinkedTrees: boolean;
}

export interface UseRstRelationsReturn {
  // ── Source relations ────────────────────────────────────────────────────────
  rstRelations: RstRelation[];
  setRstRelations: Dispatch<SetStateAction<RstRelation[]>>;
  // ── Translation-side relations (only meaningful when supportsLinkedTrees) ──
  tvRstRelations: RstRelation[];
  setTvRstRelations: Dispatch<SetStateAction<RstRelation[]>>;
  rstRelationsLinked: boolean;
  setRstRelationsLinked: Dispatch<SetStateAction<boolean>>;
  rstEditingSide: "source" | "translation";
  setRstEditingSide: Dispatch<SetStateAction<"source" | "translation">>;
  // ── Editing state ───────────────────────────────────────────────────────────
  editingRst: boolean;
  setEditingRst: Dispatch<SetStateAction<boolean>>;
  rstSegA: string | null;
  setRstSegA: Dispatch<SetStateAction<string | null>>;
  rstSegAGroupId: string | null;
  setRstSegAGroupId: Dispatch<SetStateAction<string | null>>;
  rstSegB: string | null;
  setRstSegB: Dispatch<SetStateAction<string | null>>;
  rstRolesSwapped: boolean;
  setRstRolesSwapped: Dispatch<SetStateAction<boolean>>;
  showRstPicker: boolean;
  setShowRstPicker: Dispatch<SetStateAction<boolean>>;
  /** groupId whose relation type is being edited via chip click. */
  rstEditGroupId: string | null;
  setRstEditGroupId: Dispatch<SetStateAction<string | null>>;
  // ── Handlers ────────────────────────────────────────────────────────────────
  handleSelectRstSegment: (wordId: string) => void;
  handleSelectRstGroup: (groupId: string) => void;
  handleCreateRstRelation: (relType: string) => Promise<void>;
  handleCancelRstPicker: () => void;
  /** Open the group-type editor for a chip. Closes any in-progress creation. */
  handleEditRstGroup: (groupId: string) => void;
  /** Apply the chosen type to the currently edited group. */
  handleUpdateRstGroupType: (relType: string) => Promise<void>;
  handleDeleteRstGroup: (groupId: string) => Promise<void>;
  handleUpdateRstIntersectPoint: (id: number, intersectPoint: "start" | "mid" | "end") => Promise<void>;
}

export function useRstRelations({
  initialRstRelations,
  initialTvRstRelations = [],
  book,
  textSource,
  getChapterForWord,
  supportsLinkedTrees,
}: UseRstRelationsOptions): UseRstRelationsReturn {
  const [rstRelations, setRstRelations]       = useState<RstRelation[]>(initialRstRelations);
  const [tvRstRelations, setTvRstRelations]   = useState<RstRelation[]>(initialTvRstRelations);
  // rstRelationsLinked is persisted to localStorage; only meaningful when supportsLinkedTrees.
  const [rstRelationsLinked, setRstRelationsLinked] = useState(
    () => supportsLinkedTrees ? readLocal("structura:rstLinked", true) : false
  );
  const [rstEditingSide, setRstEditingSide]   = useState<"source" | "translation">("source");
  const [editingRst, setEditingRst]           = useState(false);
  const [rstSegA, setRstSegA]                 = useState<string | null>(null);
  const [rstSegAGroupId, setRstSegAGroupId]   = useState<string | null>(null);
  const [rstSegB, setRstSegB]                 = useState<string | null>(null);
  const [rstRolesSwapped, setRstRolesSwapped] = useState(false);
  const [showRstPicker, setShowRstPicker]     = useState(false);
  const [rstEditGroupId, setRstEditGroupId]   = useState<string | null>(null);

  // Persist linked setting whenever it changes.
  useEffect(() => {
    if (supportsLinkedTrees) writeLocal("structura:rstLinked", rstRelationsLinked);
  }, [rstRelationsLinked, supportsLinkedTrees]);

  function handleSelectRstSegment(wordId: string) {
    if (!rstSegA) {
      setRstSegA(wordId);
      setRstSegAGroupId(null);
    } else if (wordId === rstSegA) {
      setRstSegA(null);
      setRstSegAGroupId(null);
      setRstSegB(null);
      setShowRstPicker(false);
    } else {
      setRstSegB(wordId);
      setRstRolesSwapped(false);
      setShowRstPicker(true);
    }
  }

  function handleSelectRstGroup(groupId: string) {
    if (!rstSegA) {
      setRstSegA(groupId);
      setRstSegAGroupId(groupId);
    } else if (rstSegA === groupId) {
      setRstSegA(null);
      setRstSegAGroupId(null);
      setShowRstPicker(false);
    } else {
      setRstSegB(groupId);
      setRstRolesSwapped(false);
      setShowRstPicker(true);
    }
  }

  async function handleCreateRstRelation(relType: string) {
    if (!rstSegA || !rstSegB) return;
    const relMeta  = RELATIONSHIP_MAP[relType];
    const category = relMeta?.category ?? "subordinate";
    const isCoord  = category === "coordinate";

    // Determine active side for unlinked mode (only relevant when supportsLinkedTrees)
    const editingTv  = supportsLinkedTrees && !rstRelationsLinked && rstEditingSide === "translation";
    const activeRels = editingTv ? tvRstRelations : rstRelations;
    const setActive  = editingTv ? setTvRstRelations : setRstRelations;
    const activeSrc  = editingTv ? `tv:${textSource}` : textSource;

    const ch = getChapterForWord(rstSegA);

    let members: { segWordId: string; role: "nucleus" | "satellite"; sortOrder: number }[];
    if (isCoord) {
      const existingGroup = activeRels.find(
        (r) => r.segWordId === rstSegA && r.relType === relType && r.role === "nucleus"
      );
      if (existingGroup) {
        const groupId   = existingGroup.groupId;
        const maxOrder  = activeRels
          .filter((r) => r.groupId === groupId)
          .reduce((m, r) => Math.max(m, r.sortOrder), 0);
        const extMember = [{ segWordId: rstSegB, role: "nucleus" as const, sortOrder: maxOrder + 1 }];

        const resp = await fetch("/api/rst-relations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId, members: extMember, relType, book, chapter: ch, source: activeSrc }),
        });
        const { relations: newRels } = await resp.json();
        setActive((prev) => [...prev, ...newRels]);

        if (supportsLinkedTrees && rstRelationsLinked) {
          const tvMax = tvRstRelations
            .filter((r) => r.groupId === groupId)
            .reduce((m, r) => Math.max(m, r.sortOrder), 0);
          const respTv = await fetch("/api/rst-relations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              groupId,
              members: [{ segWordId: rstSegB, role: "nucleus" as const, sortOrder: tvMax + 1 }],
              relType,
              book,
              chapter: ch,
              source: `tv:${textSource}`,
            }),
          });
          const { relations: newTvRels } = await respTv.json();
          setTvRstRelations((prev) => [...prev, ...newTvRels]);
        }

        setRstSegB(null);
        setShowRstPicker(false);
        return;
      }
      members = [
        { segWordId: rstSegA, role: "nucleus",  sortOrder: 0 },
        { segWordId: rstSegB, role: "nucleus",  sortOrder: 1 },
      ];
    } else {
      const nucleusId   = rstRolesSwapped ? rstSegB : rstSegA;
      const satelliteId = rstRolesSwapped ? rstSegA : rstSegB;
      members = [
        { segWordId: nucleusId,   role: "nucleus",   sortOrder: 0 },
        { segWordId: satelliteId, role: "satellite",  sortOrder: 1 },
      ];
    }

    const groupId = crypto.randomUUID();
    const resp = await fetch("/api/rst-relations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId, members, relType, book, chapter: ch, source: activeSrc }),
    });
    const { relations: newRels } = await resp.json();
    setActive((prev) => [...prev, ...newRels]);

    if (supportsLinkedTrees && rstRelationsLinked) {
      const respTv = await fetch("/api/rst-relations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, members, relType, book, chapter: ch, source: `tv:${textSource}` }),
      });
      const { relations: newTvRels } = await respTv.json();
      setTvRstRelations((prev) => [...prev, ...newTvRels]);
    }

    setRstSegB(null);
    setRstRolesSwapped(false);
    setShowRstPicker(false);
  }

  function handleCancelRstPicker() {
    setShowRstPicker(false);
    setRstSegB(null);
    setRstRolesSwapped(false);
  }

  function handleEditRstGroup(groupId: string) {
    setRstEditGroupId(groupId);
    setShowRstPicker(false);
    setRstSegA(null);
    setRstSegB(null);
    setRstRolesSwapped(false);
  }

  async function handleUpdateRstGroupType(relType: string) {
    if (!rstEditGroupId) return;
    await fetch("/api/rst-relations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: rstEditGroupId, relType }),
    });
    // Update both arrays; when unlinked only one has this groupId — safe either way.
    const applyType = (prev: RstRelation[]) =>
      prev.map((r) => r.groupId === rstEditGroupId ? { ...r, relType } : r);
    setRstRelations(applyType);
    setTvRstRelations(applyType);
    setRstEditGroupId(null);
  }

  async function handleDeleteRstGroup(groupId: string) {
    await fetch("/api/rst-relations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId }),
    });
    setRstRelations((prev) => prev.filter((r) => r.groupId !== groupId));
    setTvRstRelations((prev) => prev.filter((r) => r.groupId !== groupId));
  }

  async function handleUpdateRstIntersectPoint(id: number, intersectPoint: "start" | "mid" | "end") {
    await fetch("/api/rst-relations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, intersectPoint }),
    });
    const apply = (prev: RstRelation[]) =>
      prev.map((r) => r.id === id ? { ...r, intersectPoint } : r);
    setRstRelations(apply);
    setTvRstRelations(apply);
  }

  return {
    rstRelations,
    setRstRelations,
    tvRstRelations,
    setTvRstRelations,
    rstRelationsLinked,
    setRstRelationsLinked,
    rstEditingSide,
    setRstEditingSide,
    editingRst,
    setEditingRst,
    rstSegA,
    setRstSegA,
    rstSegAGroupId,
    setRstSegAGroupId,
    rstSegB,
    setRstSegB,
    rstRolesSwapped,
    setRstRolesSwapped,
    showRstPicker,
    setShowRstPicker,
    rstEditGroupId,
    setRstEditGroupId,
    handleSelectRstSegment,
    handleSelectRstGroup,
    handleCreateRstRelation,
    handleCancelRstPicker,
    handleEditRstGroup,
    handleUpdateRstGroupType,
    handleDeleteRstGroup,
    handleUpdateRstIntersectPoint,
  };
}
