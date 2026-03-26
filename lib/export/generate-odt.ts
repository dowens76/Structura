// Server-only: generate an ODT buffer from note sections.
import JSZip from "jszip";
import type { TiptapNode } from "./tiptap-utils";
import { tiptapIsEmpty } from "./tiptap-utils";

export type NoteSection = { label: string; content: string };

// ── XML helpers ───────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Inline text → ODF XML ─────────────────────────────────────────────────────

function inlineToOdt(nodes: TiptapNode[]): string {
  return nodes
    .filter((n) => n.type === "text")
    .map((n) => {
      const text = esc(n.text ?? "");
      const marks = n.marks ?? [];
      const bold      = marks.some((m) => m.type === "bold");
      const italic    = marks.some((m) => m.type === "italic");
      const highlight = marks.some((m) => m.type === "highlight");
      const sup       = marks.some((m) => m.type === "superscript");
      const sub       = marks.some((m) => m.type === "subscript");

      if (!bold && !italic && !highlight && !sup && !sub) return text;

      const style =
        bold && italic ? "BoldItalic" :
        bold           ? "Bold" :
        italic         ? "Italic" :
        highlight      ? "Highlight" :
        sup            ? "Super" :
                         "Sub";
      return `<text:span text:style-name="${style}">${text}</text:span>`;
    })
    .join("");
}

// ── Block nodes → ODF XML ─────────────────────────────────────────────────────

function nodeToOdt(node: TiptapNode, listCounters: { bullet: number; number: number }): string {
  switch (node.type) {
    case "heading": {
      const lv = (node.attrs?.level as number) ?? 1;
      return `<text:h text:outline-level="${lv}">${inlineToOdt(node.content ?? [])}</text:h>`;
    }

    case "paragraph":
      return `<text:p>${inlineToOdt(node.content ?? [])}</text:p>`;

    case "blockquote":
      return (node.content ?? [])
        .map((child) => {
          if (child.type === "paragraph") {
            return `<text:p text:style-name="Blockquote">${inlineToOdt(child.content ?? [])}</text:p>`;
          }
          return nodeToOdt(child, listCounters);
        })
        .join("");

    case "bulletList": {
      const id = `bullet-${++listCounters.bullet}`;
      const items = (node.content ?? [])
        .map((item) => {
          const paras = (item.content ?? [])
            .filter((c) => c.type === "paragraph")
            .map((p) => `<text:p text:style-name="ListBullet">${inlineToOdt(p.content ?? [])}</text:p>`)
            .join("");
          return `<text:list-item>${paras}</text:list-item>`;
        })
        .join("");
      return `<text:list xml:id="${id}" text:style-name="BulletListStyle">${items}</text:list>`;
    }

    case "orderedList": {
      const id = `number-${++listCounters.number}`;
      const items = (node.content ?? [])
        .map((item) => {
          const paras = (item.content ?? [])
            .filter((c) => c.type === "paragraph")
            .map((p) => `<text:p text:style-name="ListNumber">${inlineToOdt(p.content ?? [])}</text:p>`)
            .join("");
          return `<text:list-item>${paras}</text:list-item>`;
        })
        .join("");
      return `<text:list xml:id="${id}" text:style-name="NumberListStyle">${items}</text:list>`;
    }

    default:
      return "";
  }
}

// ── Content XML ───────────────────────────────────────────────────────────────

function buildContentXml(title: string, sections: NoteSection[]): string {
  const listCounters = { bullet: 0, number: 0 };

  let bodyXml = `<text:h text:outline-level="1">${esc(title)}</text:h>\n`;

  for (const sec of sections) {
    let nodes: TiptapNode[] = [];
    try {
      const doc = JSON.parse(sec.content || "{}") as TiptapNode;
      nodes = doc.content ?? [];
    } catch { /* ignore */ }

    if (tiptapIsEmpty(JSON.stringify({ type: "doc", content: nodes }))) continue;

    bodyXml += `<text:h text:outline-level="2">${esc(sec.label)}</text:h>\n`;
    bodyXml += nodes.map((n) => nodeToOdt(n, listCounters)).join("\n");
    bodyXml += "\n";
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  xmlns:text2="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  office:version="1.3">
  <office:automatic-styles>
    <!-- Inline character styles -->
    <style:style style:name="Bold" style:family="text">
      <style:text-properties fo:font-weight="bold"/>
    </style:style>
    <style:style style:name="Italic" style:family="text">
      <style:text-properties fo:font-style="italic"/>
    </style:style>
    <style:style style:name="BoldItalic" style:family="text">
      <style:text-properties fo:font-weight="bold" fo:font-style="italic"/>
    </style:style>
    <style:style style:name="Highlight" style:family="text">
      <style:text-properties fo:background-color="#ffff00"/>
    </style:style>
    <style:style style:name="Super" style:family="text">
      <style:text-properties style:text-position="super 58%"/>
    </style:style>
    <style:style style:name="Sub" style:family="text">
      <style:text-properties style:text-position="sub 58%"/>
    </style:style>
    <!-- Paragraph styles -->
    <style:style style:name="Blockquote" style:family="paragraph">
      <style:paragraph-properties fo:margin-left="1cm" fo:margin-right="1cm"
        fo:border-left="3pt solid #cccccc" fo:padding-left="0.3cm"/>
    </style:style>
    <style:style style:name="ListBullet" style:family="paragraph">
      <style:paragraph-properties fo:margin-left="0.75cm" fo:text-indent="-0.35cm"/>
    </style:style>
    <style:style style:name="ListNumber" style:family="paragraph">
      <style:paragraph-properties fo:margin-left="0.75cm" fo:text-indent="-0.35cm"/>
    </style:style>
  </office:automatic-styles>
  <office:body>
    <office:text>
      ${bodyXml}
    </office:text>
  </office:body>
</office:document-content>`;
}

// ── Manifest & MIME ───────────────────────────────────────────────────────────

const MIME = "application/vnd.oasis.opendocument.text";

const MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="${MIME}"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;

// ── Public API ────────────────────────────────────────────────────────────────

export async function buildOdtBuffer(title: string, sections: NoteSection[]): Promise<Buffer> {
  const zip = new JSZip();
  // mimetype MUST be first entry and MUST be stored uncompressed per ODF spec.
  zip.file("mimetype", MIME, { compression: "STORE" });
  zip.folder("META-INF")!.file("manifest.xml", MANIFEST);
  zip.file("content.xml", buildContentXml(title, sections));
  return zip.generateAsync({ type: "nodebuffer" }) as Promise<Buffer>;
}
