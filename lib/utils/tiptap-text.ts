/**
 * Extracts plain text from a TipTap/ProseMirror JSON string for search purposes.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walkNode(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (Array.isArray(node.content)) {
    const childText = node.content.map(walkNode).join("");
    // Add newline after block-level nodes so words don't run together
    const isBlock = ["paragraph", "heading", "blockquote", "listItem",
                     "bulletList", "orderedList", "codeBlock"].includes(node.type);
    return isBlock ? childText + "\n" : childText;
  }
  return "";
}

export function extractTextFromTipTap(json: string): string {
  if (!json || json === "{}") return "";
  try {
    return walkNode(JSON.parse(json)).trim();
  } catch {
    return "";
  }
}

/**
 * Returns a short snippet (≤ maxLen chars) centred around the first occurrence
 * of `query` in `text`, with the match bounds so the caller can highlight it.
 */
export function getSnippet(
  text: string,
  query: string,
  maxLen = 120,
): { snippet: string; matchStart: number; matchEnd: number } | null {
  if (!query || !text) return null;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;

  const half = Math.floor((maxLen - query.length) / 2);
  const start = Math.max(0, idx - half);
  const end   = Math.min(text.length, idx + query.length + half);

  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const snippet = prefix + text.slice(start, end) + suffix;
  const matchStart = prefix.length + (idx - start);
  const matchEnd   = matchStart + query.length;

  return { snippet, matchStart, matchEnd };
}
