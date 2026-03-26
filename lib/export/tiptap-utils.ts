// Shared Tiptap JSON → HTML utilities (browser- and server-safe, no Node.js deps).

export type TiptapMark = { type: string; attrs?: Record<string, unknown> };
export type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: TiptapMark[];
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineToHtml(nodes: TiptapNode[]): string {
  return nodes
    .filter((n) => n.type === "text")
    .map((n) => {
      let t = esc(n.text ?? "");
      for (const m of n.marks ?? []) {
        switch (m.type) {
          case "bold":        t = `<strong>${t}</strong>`; break;
          case "italic":      t = `<em>${t}</em>`; break;
          case "highlight":   t = `<mark>${t}</mark>`; break;
          case "superscript": t = `<sup>${t}</sup>`; break;
          case "subscript":   t = `<sub>${t}</sub>`; break;
        }
      }
      return t;
    })
    .join("");
}

function nodeToHtml(node: TiptapNode): string {
  switch (node.type) {
    case "heading": {
      const lv = (node.attrs?.level as number) ?? 1;
      return `<h${lv}>${inlineToHtml(node.content ?? [])}</h${lv}>`;
    }
    case "paragraph":
      return `<p>${inlineToHtml(node.content ?? [])}</p>`;
    case "blockquote":
      return `<blockquote>${(node.content ?? []).map(nodeToHtml).join("")}</blockquote>`;
    case "bulletList":
      return `<ul>${(node.content ?? []).map(nodeToHtml).join("")}</ul>`;
    case "orderedList":
      return `<ol>${(node.content ?? []).map(nodeToHtml).join("")}</ol>`;
    case "listItem":
      return `<li>${(node.content ?? []).map(nodeToHtml).join("")}</li>`;
    default:
      return "";
  }
}

/** Convert a stored Tiptap JSON string to an HTML fragment (no <html>/<body> wrapper). */
export function tiptapToHtml(content: string): string {
  try {
    const doc = JSON.parse(content || "{}") as TiptapNode;
    if (doc.type !== "doc" || !doc.content?.length) return "";
    return doc.content.map(nodeToHtml).join("\n");
  } catch {
    return "";
  }
}

/** True if the Tiptap JSON contains no visible text. */
export function tiptapIsEmpty(content: string): boolean {
  function hasText(nodes: TiptapNode[]): boolean {
    for (const n of nodes) {
      if (n.type === "text" && n.text?.trim()) return true;
      if (n.content && hasText(n.content)) return true;
    }
    return false;
  }
  try {
    const doc = JSON.parse(content || "{}") as TiptapNode;
    return !hasText(doc.content ?? []);
  } catch {
    return true;
  }
}
