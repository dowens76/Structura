// ── Zotero Web API types ──────────────────────────────────────────────────────

export interface ZoteroCreator {
  creatorType: string; // "author", "editor", "translator", etc.
  firstName?: string;
  lastName?: string;
  name?: string; // single-field creator (institutions, etc.)
}

export interface ZoteroItemData {
  key: string;
  itemType: string; // "journalArticle", "book", "bookSection", "thesis", etc.
  title?: string;
  shortTitle?: string;
  creators?: ZoteroCreator[];
  date?: string;
  publicationTitle?: string; // journal name (journalArticle), book title (bookSection)
  volume?: string;
  issue?: string;
  pages?: string;
  place?: string;
  publisher?: string;
  url?: string;
  DOI?: string;
}

export interface ZoteroItem {
  key: string;
  version: number;
  data: ZoteroItemData;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function lastNameOf(c: ZoteroCreator): string {
  return c.lastName ?? c.name ?? "";
}

function formatAuthors(creators: ZoteroCreator[] | undefined): string {
  const relevant = (creators ?? []).filter(
    (c) => c.creatorType === "author" || c.creatorType === "editor"
  );
  if (relevant.length === 0) return "";
  if (relevant.length === 1) return lastNameOf(relevant[0]);
  if (relevant.length === 2)
    return `${lastNameOf(relevant[0])} and ${lastNameOf(relevant[1])}`;
  return `${lastNameOf(relevant[0])} et al.`;
}

function extractYear(date?: string): string {
  if (!date) return "";
  // Handle "2023", "2023-05", "2023-05-01", "May 2023", etc.
  const m = date.match(/\b(\d{4})\b/);
  return m ? m[1] : "";
}

// ── Public formatters ─────────────────────────────────────────────────────────

/**
 * Returns a Chicago-style inline citation as an HTML string suitable for
 * insertion into a TipTap editor via `insertContent(html)`.
 * Only uses <em> — already supported by StarterKit's Italic mark.
 */
export function formatCitationHtml(item: ZoteroItem): string {
  const d       = item.data;
  const authors = formatAuthors(d.creators);
  const year    = extractYear(d.date);
  const title   = d.shortTitle || d.title || "";

  const parts: string[] = [];
  if (authors) parts.push(authors);
  if (title)   parts.push(`<em>${title}</em>`);

  const base = parts.join(", ");
  return year ? `${base} (${year})` : base;
}

/**
 * Returns a short plain-text summary for display in the citation picker list.
 */
export function formatItemSummary(item: ZoteroItem): string {
  const d = item.data;
  const authors = formatAuthors(d.creators);
  const year = extractYear(d.date);
  const raw = d.title ?? "";
  const title = raw.length > 60 ? raw.substring(0, 57) + "\u2026" : raw;
  const parts = [authors, title, year].filter(Boolean);
  return parts.join(" \u2014 ");
}
