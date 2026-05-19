/**
 * Converts USFM inline-marker text to React nodes for display.
 *
 * Supported markers:
 *  \nd...\nd*   → small-caps span (divine name)
 *  \add...\add* → italic span (translator addition)
 *  \wj...\wj*  → red span (words of Jesus)
 *  \qt...\qt*  → pale gray background span (quoted text)
 *  \it...\it*  → italic span
 *  \qs...\qs*  → block-level right-justified span (Selah)
 *  \bd...\bd*  → bold span
 *  \fn...\fn*  → superscript footnote letter (a, b, c…) — content is always empty
 *
 * All other content is returned as plain text.
 */

import React from "react";

type Segment =
  | { kind: "text"; text: string }
  | { kind: "nd"; text: string }
  | { kind: "add"; text: string }
  | { kind: "wj"; text: string }
  | { kind: "qt"; text: string }
  | { kind: "it"; text: string }
  | { kind: "qs"; text: string }
  | { kind: "bd"; text: string }
  | { kind: "fn"; text: string };

const INLINE_RE = /\\(nd|add|wj|qt|it|qs|bd|fn)\s+([\s\S]*?)\\(?:nd|add|wj|qt|it|qs|bd|fn)\*/g;

function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ kind: "text", text: text.slice(lastIndex, m.index) });
    }
    const marker = m[1] as "nd" | "add" | "wj" | "qt" | "it" | "qs" | "bd" | "fn";
    segments.push({ kind: marker, text: m[2] });
    lastIndex = m.index + m[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: "text", text: text.slice(lastIndex) });
  }

  return segments;
}

export function renderUsfmText(text: string): React.ReactNode {
  if (!text) return null;

  const segments = parseSegments(text);
  if (segments.length === 1 && segments[0].kind === "text") {
    return segments[0].text;
  }

  let fnCounter = 0;

  return React.createElement(
    React.Fragment,
    null,
    ...segments.map((seg, i) => {
      if (seg.kind === "text") return seg.text;
      if (seg.kind === "nd") {
        return React.createElement(
          "span",
          { key: i, style: { fontVariant: "small-caps" } },
          seg.text,
        );
      }
      if (seg.kind === "add") {
        return React.createElement("em", { key: i }, seg.text);
      }
      if (seg.kind === "wj") {
        return React.createElement(
          "span",
          { key: i, className: "text-red-600 dark:text-red-400" },
          seg.text,
        );
      }
      if (seg.kind === "qt") {
        return React.createElement(
          "span",
          { key: i, className: "bg-neutral-100 dark:bg-neutral-800 rounded px-0.5" },
          seg.text,
        );
      }
      if (seg.kind === "it") {
        return React.createElement("em", { key: i }, seg.text);
      }
      if (seg.kind === "qs") {
        return React.createElement(
          "span",
          { key: i, className: "block text-right italic" },
          seg.text,
        );
      }
      if (seg.kind === "bd") {
        return React.createElement("strong", { key: i }, seg.text);
      }
      if (seg.kind === "fn") {
        const letter = String.fromCharCode(97 + (fnCounter++ % 26));
        return React.createElement(
          "sup",
          { key: i, className: "text-[0.65em] font-normal leading-none align-super text-stone-400 dark:text-stone-500" },
          letter,
        );
      }
      return (seg as { kind: string; text: string }).text;
    }),
  );
}

/** Returns true if the text contains any inline USFM markers. */
export function hasUsfmMarkers(text: string): boolean {
  return /\\(nd|add|wj|qt|it|qs|bd|fn|f|x)\s/.test(text);
}

/**
 * Strips all inline USFM markers and returns plain text.
 * Used for search indexing, export plain-text preview, etc.
 */
export function stripUsfmMarkers(text: string): string {
  return text
    .replace(/\\[a-z]+\d*\s+([\s\S]*?)\\[a-z]+\d*\*/g, "$1")
    .replace(/\\[a-z]+\d*\*/g, "")
    .replace(/\\[a-z]+\d*\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
