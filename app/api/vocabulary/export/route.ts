import { NextRequest, NextResponse } from "next/server";
import { resolveVocabularyList, type VocabScopeParams, type VocabWord } from "@/lib/vocabulary/resolve";
import { csvField } from "@/lib/utils/csv";
import { generateApkg } from "@/lib/anki/generateApkg";
import { POS_LABELS } from "@/lib/morphology/types";

export const dynamic = "force-dynamic";

const VALID_TEXT_SOURCES = new Set(["OSHB", "SBLGNT", "STEPBIBLE_LXX"]);

function buildScopeLabel(osisBooks: string[], chapterStart?: number, chapterEnd?: number): string {
  const raw = osisBooks.length === 1
    ? (chapterStart != null && chapterEnd != null ? `${osisBooks[0]}_${chapterStart}-${chapterEnd}` : osisBooks[0])
    : `${osisBooks.length}books`;
  return raw.replace(/[^\w\- ]/g, "_");
}

function buildCsv(words: VocabWord[]): string {
  const header = ["Lemma", "Strong's Number", "Part of Speech", "Gloss", "Corpus-wide Count"].map(csvField).join(",");
  const rows = words.map((w) => [w.lemma, w.strongNumber, w.partOfSpeech, w.gloss, w.corpusCount].map(csvField).join(","));
  return [header, ...rows].join("\r\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Anki card content deliberately omits the Strong's number (front and back)
// — the card tests recognition of the word itself, not recall-by-number.
function buildAnkiNotes(words: VocabWord[], isHebrew: boolean): { front: string; back: string }[] {
  return words.map((w) => {
    const front = `<div dir="${isHebrew ? "rtl" : "ltr"}">${escapeHtml(w.lemma ?? "")}</div>`;
    const backParts = [
      w.gloss ? escapeHtml(w.gloss) : null,
      w.partOfSpeech ? (POS_LABELS[w.partOfSpeech] ?? w.partOfSpeech) : null,
      `${w.corpusCount.toLocaleString()} occurrences`,
    ].filter((p): p is string => !!p);
    return { front, back: backParts.join("<br>") };
  });
}

// POST body: VocabScopeParams & { format: "csv" | "apkg" }
export async function POST(request: NextRequest) {
  let body: Partial<VocabScopeParams> & { format?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { textSource, osisBooks, chapterStart, chapterEnd, minOccurrences, maxOccurrences, format } = body;

  if (!textSource || !VALID_TEXT_SOURCES.has(textSource)) {
    return NextResponse.json({ error: "Missing or invalid textSource" }, { status: 400 });
  }
  if (!Array.isArray(osisBooks) || osisBooks.length === 0) {
    return NextResponse.json({ error: "osisBooks must be a non-empty array" }, { status: 400 });
  }
  if ((chapterStart != null || chapterEnd != null) && osisBooks.length !== 1) {
    return NextResponse.json({ error: "chapterStart/chapterEnd are only valid when osisBooks has exactly one book" }, { status: 400 });
  }
  if (format !== "csv" && format !== "apkg") {
    return NextResponse.json({ error: "format must be 'csv' or 'apkg'" }, { status: 400 });
  }

  const min = typeof minOccurrences === "number" && minOccurrences >= 0 ? minOccurrences : 1;
  const max = typeof maxOccurrences === "number" && maxOccurrences >= 0 ? maxOccurrences : null;

  const words = await resolveVocabularyList({
    textSource,
    osisBooks,
    chapterStart: chapterStart ?? undefined,
    chapterEnd: chapterEnd ?? undefined,
    minOccurrences: min,
    maxOccurrences: max,
  });

  const scopeLabel = buildScopeLabel(osisBooks, chapterStart ?? undefined, chapterEnd ?? undefined);

  if (format === "csv") {
    const csv = buildCsv(words);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="Vocabulary-${scopeLabel}.csv"`,
      },
    });
  }

  const isHebrew = textSource === "OSHB";
  const ankiNotes = buildAnkiNotes(words, isHebrew);
  const apkgBuffer = await generateApkg(ankiNotes, { deckName: `Vocabulary-${scopeLabel}` });
  return new NextResponse(new Uint8Array(apkgBuffer), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="Vocabulary-${scopeLabel}.apkg"`,
    },
  });
}
