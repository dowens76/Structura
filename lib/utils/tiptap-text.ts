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

// ── TipTap → HTML ────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderMarks(text: string, marks: any[]): string {
  let out = esc(text);
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case "bold":        out = `<strong>${out}</strong>`; break;
      case "italic":      out = `<em>${out}</em>`; break;
      case "underline":   out = `<u>${out}</u>`; break;
      case "strike":      out = `<s>${out}</s>`; break;
      case "code":        out = `<code>${out}</code>`; break;
      case "highlight":   out = `<mark>${out}</mark>`; break;
      case "superscript": out = `<sup>${out}</sup>`; break;
      case "subscript":   out = `<sub>${out}</sub>`; break;
    }
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nodeToHtml(node: any): string {
  if (!node) return "";
  if (node.type === "text") return renderMarks(node.text ?? "", node.marks ?? []);

  const children = (node.content ?? []).map(nodeToHtml).join("");

  switch (node.type) {
    case "doc":         return children;
    case "paragraph":   return children ? `<p>${children}</p>` : "";
    case "heading": {
      const level = node.attrs?.level ?? 1;
      return `<h${level}>${children}</h${level}>`;
    }
    case "bulletList":  return `<ul style="padding-left:1.5em">${children}</ul>`;
    case "orderedList": {
      const start = node.attrs?.start ?? 1;
      const attr  = start !== 1 ? ` start="${start}"` : "";
      return `<ol${attr} style="padding-left:1.5em">${children}</ol>`;
    }
    case "listItem": {
      // Unwrap a single-paragraph listItem to avoid extra spacing
      const content = node.content ?? [];
      if (content.length === 1 && content[0].type === "paragraph") {
        return `<li>${(content[0].content ?? []).map(nodeToHtml).join("")}</li>`;
      }
      return `<li>${children}</li>`;
    }
    case "blockquote":    return `<blockquote>${children}</blockquote>`;
    case "codeBlock":     return `<pre><code>${children}</code></pre>`;
    case "horizontalRule": return "<hr>";
    case "hardBreak":     return "<br>";
    default:              return children;
  }
}

/** Convert a TipTap/ProseMirror JSON string to an HTML string. */
export function tiptapToHtml(json: string): string {
  if (!json || json === "{}") return "";
  try {
    return nodeToHtml(JSON.parse(json)).trim();
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
