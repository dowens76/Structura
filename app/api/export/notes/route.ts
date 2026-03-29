import { NextRequest, NextResponse } from "next/server";
import { userDb } from "@/lib/db";
import { notes } from "@/lib/db/schema";
import { and, inArray, eq } from "drizzle-orm";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { buildDocxBuffer } from "@/lib/export/generate-docx";
import { buildOdtBuffer }  from "@/lib/export/generate-odt";
import type { NoteSection } from "@/lib/export/generate-docx";

// POST /api/export/notes
// Body: { keys: string[]; title: string; format: "docx" | "odt" }
// Returns binary file download.
export async function POST(request: NextRequest) {
  let body: { keys?: string[]; title?: string; format?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { keys, title = "Notes", format } = body;

  if (!Array.isArray(keys) || keys.length === 0) {
    return NextResponse.json({ error: "No keys provided" }, { status: 400 });
  }
  if (format !== "docx" && format !== "odt") {
    return NextResponse.json({ error: "format must be 'docx' or 'odt'" }, { status: 400 });
  }

  const workspaceId = await getActiveWorkspaceId();

  // Fetch notes from DB.
  const rows = await userDb
    .select({ key: notes.key, content: notes.content })
    .from(notes)
    .where(and(inArray(notes.key, keys), eq(notes.workspaceId, workspaceId)));

  const contentByKey = new Map(rows.map((r) => [r.key, r.content]));

  // Build ordered sections (same order as keys, which the caller orders).
  // Derive section labels from note keys:
  //   passage:42         → "Passage Note"
  //   chapter:Gen.1      → "Chapter 1"
  //   verse:Gen.1.1      → "Verse 1"         (single-chapter context)
  //   verse:Gen.2.1      → "Chapter 2 · Verse 1"  (multi-chapter context)
  const chapters = new Set<number>();
  for (const key of keys) {
    const [type, ref] = key.split(":");
    if (!ref) continue;
    if (type === "chapter") {
      const parts = ref.split(".");
      const ch = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(ch)) chapters.add(ch);
    }
    if (type === "verse") {
      const parts = ref.split(".");
      if (parts.length >= 3) {
        const ch = parseInt(parts[parts.length - 2], 10);
        if (!isNaN(ch)) chapters.add(ch);
      }
    }
  }
  const multiChapter = chapters.size > 1;

  function keyToLabel(key: string): string {
    const [type, ref] = key.split(":");
    if (!ref) return key;
    const parts = ref.split(".");
    switch (type) {
      case "passage":
        return "Passage Note";
      case "chapter": {
        const ch = parseInt(parts[parts.length - 1], 10);
        return isNaN(ch) ? "Chapter Note" : `Chapter ${ch}`;
      }
      case "verse": {
        if (parts.length < 2) return "Verse";
        const v  = parseInt(parts[parts.length - 1], 10);
        const ch = parseInt(parts[parts.length - 2], 10);
        if (multiChapter && !isNaN(ch)) return `Chapter ${ch} · Verse ${v}`;
        return isNaN(v) ? "Verse" : `Verse ${v}`;
      }
      default:
        return key;
    }
  }

  const sections: NoteSection[] = keys.map((key) => ({
    label:   keyToLabel(key),
    content: contentByKey.get(key) ?? "{}",
  }));

  // Check at least one section has content.
  const { tiptapIsEmpty } = await import("@/lib/export/tiptap-utils");
  const hasAny = sections.some((s) => !tiptapIsEmpty(s.content));
  if (!hasAny) {
    return NextResponse.json({ error: "No notes found" }, { status: 404 });
  }

  if (format === "docx") {
    const buffer = await buildDocxBuffer(title, sections);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="notes.docx"`,
      },
    });
  } else {
    const buffer = await buildOdtBuffer(title, sections);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.oasis.opendocument.text",
        "Content-Disposition": `attachment; filename="notes.odt"`,
      },
    });
  }
}
