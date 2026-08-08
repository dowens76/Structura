/**
 * The version equivalent of lib/workspace.ts's getActiveWorkspaceId() — but
 * DB-backed (active_version_selections table) rather than cookie-backed,
 * since a version is scoped per (workspace, book, chapter) locus and a
 * per-locus cookie map would grow unboundedly with usage. The real logic
 * lives in lib/db/queries.ts to avoid a circular import (queries.ts already
 * needs to call this during bulk operations that span many loci); this file
 * just gives API routes and page components the same short import ergonomics
 * as the workspace helper.
 */
import { resolveActiveVersionId, setActiveVersionSelection } from "@/lib/db/queries";

export async function getActiveVersionId(workspaceId: number, book: string, chapter: number): Promise<number> {
  return resolveActiveVersionId(workspaceId, book, chapter);
}

export async function setActiveVersionId(workspaceId: number, book: string, chapter: number, versionId: number): Promise<void> {
  await setActiveVersionSelection(workspaceId, book, chapter, versionId);
}
