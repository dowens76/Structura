import { NextRequest, NextResponse } from "next/server";
import { createIntertextualLink } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const REQUIRED_COLS = [
  "sourceBook", "sourceChapter", "sourceVerse", "sourceTextSource",
  "targetBook", "targetChapter", "targetVerse", "targetTextSource",
  "linkType",
];

function parseRow(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let j = i + 1;
      let cell = "";
      while (j < line.length) {
        if (line[j] === '"' && line[j + 1] === '"') { cell += '"'; j += 2; }
        else if (line[j] === '"') { j++; break; }
        else { cell += line[j++]; }
      }
      cells.push(cell);
      if (line[j] === ",") j++;
      i = j;
    } else {
      const end = line.indexOf(",", i);
      if (end === -1) { cells.push(line.slice(i)); break; }
      cells.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return cells;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];
  const headers = parseRow(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < lines.length; r++) {
    const line = lines[r].trim();
    if (!line) continue;
    const cells = parseRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    rows.push(row);
  }
  return rows;
}

export async function POST(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const text = await req.text();

  let rows: Record<string, string>[];
  try {
    rows = parseCsv(text);
  } catch {
    return NextResponse.json({ error: "Could not parse CSV" }, { status: 400 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "No data rows found" }, { status: 400 });
  }

  const missingCols = REQUIRED_COLS.filter((c) => !(c in rows[0]));
  if (missingCols.length > 0) {
    return NextResponse.json(
      { error: `Missing required columns: ${missingCols.join(", ")}` },
      { status: 400 }
    );
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const missingVals = REQUIRED_COLS.filter((c) => !row[c]);
    if (missingVals.length > 0) {
      errors.push(`Row ${rowNum}: missing ${missingVals.join(", ")}`);
      skipped++;
      continue;
    }

    const sourceChapter = parseInt(row.sourceChapter);
    const sourceVerse   = parseInt(row.sourceVerse);
    const targetChapter = parseInt(row.targetChapter);
    const targetVerse   = parseInt(row.targetVerse);

    if (isNaN(sourceChapter) || isNaN(sourceVerse) || isNaN(targetChapter) || isNaN(targetVerse)) {
      errors.push(`Row ${rowNum}: chapter/verse values must be integers`);
      skipped++;
      continue;
    }

    try {
      await createIntertextualLink(
        {
          sourceBook: row.sourceBook,
          sourceChapter,
          sourceVerse,
          sourceEndVerse: row.sourceEndVerse ? parseInt(row.sourceEndVerse) : null,
          sourceTextSource: row.sourceTextSource,
          sourceStartWordId: row.sourceStartWordId || null,
          sourceEndWordId:   row.sourceEndWordId   || null,
          targetBook: row.targetBook,
          targetChapter,
          targetVerse,
          targetEndVerse: row.targetEndVerse ? parseInt(row.targetEndVerse) : null,
          targetTextSource: row.targetTextSource,
          targetStartWordId: row.targetStartWordId || null,
          targetEndWordId:   row.targetEndWordId   || null,
          linkType:  row.linkType,
          strength:  row.strength ? parseInt(row.strength) : 3,
          notes:     row.notes     || null,
          direction: row.direction || "source_to_target",
        },
        workspaceId
      );
      imported++;
    } catch (e) {
      errors.push(`Row ${rowNum}: ${e instanceof Error ? e.message : "insert failed"}`);
      skipped++;
    }
  }

  return NextResponse.json({ imported, skipped, errors: errors.slice(0, 20) });
}
