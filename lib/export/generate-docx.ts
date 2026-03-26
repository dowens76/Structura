// Server-only: generate a DOCX buffer from note sections.
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  LevelFormat,
} from "docx";
import type { TiptapNode } from "./tiptap-utils";
import { tiptapIsEmpty } from "./tiptap-utils";

export type NoteSection = { label: string; content: string };

// ── Inline text runs ──────────────────────────────────────────────────────────

function inlineRuns(nodes: TiptapNode[]): TextRun[] {
  const runs = nodes
    .filter((n) => n.type === "text")
    .map((n) => {
      const marks = n.marks ?? [];
      const bold      = marks.some((m) => m.type === "bold")        || undefined;
      const italics   = marks.some((m) => m.type === "italic")      || undefined;
      const highlight = marks.some((m) => m.type === "highlight")   ? ("yellow" as const) : undefined;
      const superScript = marks.some((m) => m.type === "superscript") || undefined;
      const subScript   = marks.some((m) => m.type === "subscript")   || undefined;
      return new TextRun({ text: n.text ?? "", bold, italics, highlight, superScript, subScript });
    });
  return runs.length ? runs : [new TextRun({ text: "" })];
}

// ── Block nodes → Paragraph[] ─────────────────────────────────────────────────

function nodeToParagraphs(node: TiptapNode, olRef: Map<TiptapNode, string>): Paragraph[] {
  switch (node.type) {
    case "heading": {
      const lv = (node.attrs?.level as number) ?? 1;
      const heading =
        lv === 1 ? HeadingLevel.HEADING_1 :
        lv === 2 ? HeadingLevel.HEADING_2 :
                   HeadingLevel.HEADING_3;
      return [new Paragraph({ heading, children: inlineRuns(node.content ?? []) })];
    }

    case "paragraph":
      return [new Paragraph({ children: inlineRuns(node.content ?? []) })];

    case "blockquote":
      return (node.content ?? []).flatMap((child) => {
        if (child.type === "paragraph") {
          return [new Paragraph({ children: inlineRuns(child.content ?? []), indent: { left: 720 } })];
        }
        return nodeToParagraphs(child, olRef);
      });

    case "bulletList":
      return (node.content ?? []).flatMap((item) =>
        (item.content ?? [])
          .filter((c) => c.type === "paragraph")
          .map((p) => new Paragraph({ children: inlineRuns(p.content ?? []), bullet: { level: 0 } }))
      );

    case "orderedList": {
      const ref = olRef.get(node) ?? "ol-0";
      return (node.content ?? []).flatMap((item) =>
        (item.content ?? [])
          .filter((c) => c.type === "paragraph")
          .map((p) => new Paragraph({ children: inlineRuns(p.content ?? []), numbering: { reference: ref, level: 0 } }))
      );
    }

    default:
      return [];
  }
}

// ── Register ordered lists (must be done before building the Document) ────────

function collectOrderedLists(nodes: TiptapNode[], map: Map<TiptapNode, string>, counter: { n: number }) {
  for (const node of nodes) {
    if (node.type === "orderedList") {
      map.set(node, `ol-${++counter.n}`);
    }
    if (node.content) collectOrderedLists(node.content, map, counter);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function buildDocxBuffer(title: string, sections: NoteSection[]): Promise<Buffer> {
  // Collect all top-level content nodes so we can register ordered lists up front.
  const allDocNodes: TiptapNode[] = [];
  const parsedSections: { label: string; nodes: TiptapNode[] }[] = [];

  for (const sec of sections) {
    let nodes: TiptapNode[] = [];
    try {
      const doc = JSON.parse(sec.content || "{}") as TiptapNode;
      nodes = doc.content ?? [];
    } catch { /* ignore */ }
    allDocNodes.push(...nodes);
    parsedSections.push({ label: sec.label, nodes });
  }

  const olRef = new Map<TiptapNode, string>();
  const counter = { n: 0 };
  collectOrderedLists(allDocNodes, olRef, counter);

  // Build numbering config for each distinct ordered list.
  const numberingConfig = counter.n > 0
    ? {
        config: Array.from({ length: counter.n }, (_, i) => ({
          reference: `ol-${i + 1}`,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        })),
      }
    : undefined;

  // Build child paragraphs.
  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title })] }),
  ];

  for (const { label, nodes } of parsedSections) {
    if (tiptapIsEmpty(JSON.stringify({ type: "doc", content: nodes }))) continue;
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: label })] })
    );
    for (const node of nodes) {
      children.push(...nodeToParagraphs(node, olRef));
    }
  }

  const doc = new Document({
    numbering: numberingConfig,
    sections: [{ children }],
  });

  return Packer.toBuffer(doc);
}
