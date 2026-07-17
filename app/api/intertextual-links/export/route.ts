import { NextRequest, NextResponse } from "next/server";
import {
  getAllIntertextualLinks,
  getIntertextualLinksForBook,
  getIntertextualLinksForChapter,
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import type { IntertextualLink } from "@/lib/db/schema";
import { csvField } from "@/lib/utils/csv";

export const dynamic = "force-dynamic";

const COLUMNS = [
  "id", "sourceBook", "sourceChapter", "sourceVerse", "sourceEndVerse",
  "sourceTextSource", "sourceStartWordId", "sourceEndWordId",
  "targetBook", "targetChapter", "targetVerse", "targetEndVerse",
  "targetTextSource", "targetStartWordId", "targetEndWordId",
  "linkType", "strength", "notes", "direction", "createdAt",
] as const;

function toCsv(links: IntertextualLink[]): string {
  const rows = [COLUMNS.join(",")];
  for (const link of links) {
    rows.push(COLUMNS.map((col) => csvField((link as Record<string, unknown>)[col])).join(","));
  }
  return rows.join("\r\n");
}

export async function GET(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = req.nextUrl;
  const scope   = searchParams.get("scope") ?? "corpus";
  const book    = searchParams.get("book");
  const chapter = searchParams.get("chapter");

  let links: IntertextualLink[];
  let filename: string;

  if (scope === "passage" && book && chapter) {
    links = await getIntertextualLinksForChapter(book, parseInt(chapter), workspaceId);
    filename = `intertextual-${book}-${chapter}`;
  } else if (scope === "book" && book) {
    links = await getIntertextualLinksForBook(book, workspaceId);
    filename = `intertextual-${book}`;
  } else {
    links = await getAllIntertextualLinks(workspaceId);
    filename = "intertextual-corpus";
  }

  const csv = toCsv(links);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
    },
  });
}
