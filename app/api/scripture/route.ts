import { NextRequest, NextResponse } from "next/server";
import { eq, and, gte, lte } from "drizzle-orm";
import { userDb } from "@/lib/db";
import { translationVerses, translations } from "@/lib/db/user-schema";
import { getAppSetting, getUltVerses, getVcbVerses } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/scripture
 *
 * Query params:
 *   ref           — OSIS ref, e.g. "John.3.16" or "Gen.1.1-Gen.1.3"
 *   localId       — integer ID of a locally-imported translation
 *   bibleId       — api.bible Bible ID (requires stored api key)
 *   fetchBibleId  — fetch.bible translation ID, e.g. "eng_bsb" (no key needed)
 *   abbr          — display abbreviation to use in the response
 *
 * Returns { text, translation } on success, or { error } on failure.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ref          = searchParams.get("ref");
  const localIdParam = searchParams.get("localId");
  const bibleId      = searchParams.get("bibleId");
  const fetchBibleId = searchParams.get("fetchBibleId");
  const abbr         = searchParams.get("abbr");

  if (!ref) {
    return NextResponse.json({ error: "missing ref" }, { status: 400 });
  }

  // ── Local DB lookup ────────────────────────────────────────────────────────
  if (localIdParam) {
    const localId = parseInt(localIdParam, 10);
    if (!isNaN(localId)) {
      const result = await fetchLocalVerses(localId, ref);
      if (result) return NextResponse.json(result);
    }
  }

  // ── fetch.bible lookup (free, no key) ──────────────────────────────────────
  if (fetchBibleId) {
    try {
      const result = await fetchFromFetchBible(fetchBibleId, ref);
      if (result) return NextResponse.json({ ...result, translation: abbr ?? result.translation });
    } catch {
      return NextResponse.json({ error: "api_error" }, { status: 502 });
    }
  }

  // ── api.bible lookup ───────────────────────────────────────────────────────
  if (bibleId) {
    const apiKey = await getAppSetting("apiBible:apiKey");
    if (!apiKey) {
      return NextResponse.json({ error: "no_api_key" });
    }
    try {
      const result = await fetchFromApiBible(apiKey, bibleId, ref);
      if (result) return NextResponse.json({ ...result, translation: abbr ?? result.translation });
    } catch (err) {
      if ((err as { code?: string }).code === "bad_api_key") {
        return NextResponse.json({ error: "bad_api_key" });
      }
      return NextResponse.json({ error: "api_error" }, { status: 502 });
    }
  }

  return NextResponse.json({ error: "not_found" });
}

// ─── Local DB ─────────────────────────────────────────────────────────────────

async function fetchLocalVerses(
  translationId: number,
  osisRef: string
): Promise<{ text: string; translation: string } | null> {
  const parsed = parseOsisRange(osisRef);
  if (!parsed) return null;

  // Look up abbreviation first so we can route ULT to its own DB
  const [trans] = await userDb
    .select({ abbreviation: translations.abbreviation })
    .from(translations)
    .where(eq(translations.id, translationId))
    .limit(1);

  if (!trans) return null;

  if (trans.abbreviation === "ULT") {
    return fetchUltVerses(parsed);
  }

  if (trans.abbreviation === "VCB") {
    return fetchVcbVerses(parsed);
  }

  const { book, chapter, verse, endBook, endChapter, endVerse } = parsed;

  let rows: Array<{ text: string; chapter: number; verse: number }>;

  if (endVerse === undefined) {
    // Single verse or chapter-only
    if (verse === undefined) {
      // Chapter-only: return first verse as a summary isn't practical; return all verses
      rows = await userDb
        .select({ text: translationVerses.text, chapter: translationVerses.chapter, verse: translationVerses.verse })
        .from(translationVerses)
        .where(
          and(
            eq(translationVerses.translationId, translationId),
            eq(translationVerses.chapter, chapter)
          )
        )
        .orderBy(translationVerses.verse);
    } else {
      const exactRef = `${book}.${chapter}.${verse}`;
      rows = await userDb
        .select({ text: translationVerses.text, chapter: translationVerses.chapter, verse: translationVerses.verse })
        .from(translationVerses)
        .where(
          and(
            eq(translationVerses.translationId, translationId),
            eq(translationVerses.osisRef, exactRef)
          )
        );
    }
  } else {
    // Range — collect all verses between start and end (same book assumed)
    rows = await userDb
      .select({ text: translationVerses.text, chapter: translationVerses.chapter, verse: translationVerses.verse })
      .from(translationVerses)
      .where(
        and(
          eq(translationVerses.translationId, translationId),
          // Use chapter+verse numeric comparison for cross-chapter ranges
          gte(translationVerses.chapter, chapter),
          lte(translationVerses.chapter, endChapter ?? chapter)
        )
      )
      .orderBy(translationVerses.chapter, translationVerses.verse);

    // Filter out-of-range verses when spanning chapters
    rows = rows.filter((r) => {
      const startOk = r.chapter > chapter || r.verse >= verse!;
      const endOk = r.chapter < (endChapter ?? chapter) || r.verse <= endVerse;
      return startOk && endOk;
    });
  }

  if (rows.length === 0) return null;

  const multiVerse = rows.length > 1;
  const text = rows
    .map((r) => (multiVerse ? `${r.verse} ${r.text}` : r.text))
    .join(" ");
  return { text, translation: trans.abbreviation };
}

// ─── ULT (lives in ult.db, not translationVerses) ─────────────────────────────

function fetchUltVerses(
  parsed: ParsedOsisRange
): { text: string; translation: string } | null {
  const { book, chapter, verse, endChapter, endVerse } = parsed;

  if (endVerse === undefined) {
    // Single verse or chapter-only
    const chapterVerses = getUltVerses(book, chapter);
    if (verse === undefined) {
      if (chapterVerses.length === 0) return null;
      return { text: chapterVerses.map((r) => `${r.verse} ${r.text}`).join(" "), translation: "ULT" };
    }
    const row = chapterVerses.find((r) => r.verse === verse);
    if (!row) return null;
    return { text: row.text, translation: "ULT" };
  }

  // Range — may span chapters
  const endCh = endChapter ?? chapter;
  const rows: { verse: number; text: string }[] = [];
  for (let ch = chapter; ch <= endCh; ch++) {
    const chapterVerses = getUltVerses(book, ch);
    for (const r of chapterVerses) {
      const afterStart = ch > chapter || r.verse >= verse!;
      const beforeEnd  = ch < endCh   || r.verse <= endVerse;
      if (afterStart && beforeEnd) rows.push(r);
    }
  }

  if (rows.length === 0) return null;
  return { text: rows.map((r) => `${r.verse} ${r.text}`).join(" "), translation: "ULT" };
}

// ─── VCB (Biblica® Open Vietnamese Contemporary Bible 2015) ───────────────────

function fetchVcbVerses(
  parsed: ParsedOsisRange
): { text: string; translation: string } | null {
  const { book, chapter, verse, endChapter, endVerse } = parsed;

  if (endVerse === undefined) {
    const chapterVerses = getVcbVerses(book, chapter);
    if (verse === undefined) {
      if (chapterVerses.length === 0) return null;
      return { text: chapterVerses.map((r) => `${r.verse} ${r.text}`).join(" "), translation: "VCB" };
    }
    const row = chapterVerses.find((r) => r.verse === verse);
    if (!row) return null;
    return { text: row.text, translation: "VCB" };
  }

  // Range — may span chapters
  const endCh = endChapter ?? chapter;
  const rows: { verse: number; text: string }[] = [];
  for (let ch = chapter; ch <= endCh; ch++) {
    const chapterVerses = getVcbVerses(book, ch);
    for (const r of chapterVerses) {
      const afterStart = ch > chapter || r.verse >= verse!;
      const beforeEnd  = ch < endCh   || r.verse <= endVerse;
      if (afterStart && beforeEnd) rows.push(r);
    }
  }

  if (rows.length === 0) return null;
  return { text: rows.map((r) => `${r.verse} ${r.text}`).join(" "), translation: "VCB" };
}

// ─── fetch.bible ───────────────────────────────────────────────────────────────

// fetch.bible uses lowercase USFM book codes (same as USFM but lowercased)
// We share the OSIS_TO_USFM map defined below and lowercase the result.

type FetchBibleItem = string | { type: string; contents: string; level?: number };

function extractFetchBibleText(items: FetchBibleItem[]): string {
  return items
    .filter((x): x is string => typeof x === "string")
    .join("")
    .replace(/\n+/g, " ")
    .trim();
}

async function fetchFromFetchBible(
  translationId: string,
  osisRef: string
): Promise<{ text: string; translation: string } | null> {
  const parsed = parseOsisRange(osisRef);
  if (!parsed) return null;

  // Convert OSIS book code → lowercase USX (fetch.bible format)
  const usfm = OSIS_TO_USFM[parsed.book];
  if (!usfm) return null;
  const bookCode = usfm.toLowerCase();

  const url = `https://v1.fetch.bible/bibles/${encodeURIComponent(translationId)}/txt/${bookCode}.json`;
  const res = await fetch(url, { next: { revalidate: 604800 } }); // cache 1 week
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`fetch.bible responded ${res.status}`);
  }

  const data = await res.json() as {
    name?: { abbrev?: string };
    // contents[chapter][verse] = FetchBibleItem[]
    // Both chapter and verse are 1-based; index 0 is an empty placeholder.
    contents: FetchBibleItem[][][];
  };

  const abbrev = data.name?.abbrev ?? translationId;
  const contents = data.contents;
  const { chapter, verse, endChapter, endVerse } = parsed;

  if (verse === undefined) {
    // Whole chapter
    const chap = contents[chapter];
    if (!chap) return null;
    const parts: string[] = [];
    for (let v = 1; v < chap.length; v++) {
      if (chap[v]) parts.push(`${v} ${extractFetchBibleText(chap[v])}`);
    }
    return parts.length ? { text: parts.join(" "), translation: abbrev } : null;
  }

  if (endVerse === undefined) {
    // Single verse
    const items = contents[chapter]?.[verse];
    if (!items) return null;
    return { text: extractFetchBibleText(items), translation: abbrev };
  }

  // Range — may span chapters
  const endCh = endChapter ?? chapter;
  const parts: string[] = [];
  for (let ch = chapter; ch <= endCh; ch++) {
    const chap = contents[ch];
    if (!chap) continue;
    const startV = ch === chapter ? verse : 1;
    const endV   = ch === endCh   ? endVerse : chap.length - 1;
    for (let v = startV; v <= endV; v++) {
      if (chap[v]) parts.push(`${v} ${extractFetchBibleText(chap[v])}`);
    }
  }
  return parts.length ? { text: parts.join(" "), translation: abbrev } : null;
}

// ─── api.bible ─────────────────────────────────────────────────────────────────

// Maps OSIS book codes to api.bible's USFM 3-letter codes
const OSIS_TO_USFM: Record<string, string> = {
  Gen:"GEN",Exod:"EXO",Lev:"LEV",Num:"NUM",Deut:"DEU",Josh:"JOS",Judg:"JDG",
  Ruth:"RUT","1Sam":"1SA","2Sam":"2SA","1Kgs":"1KI","2Kgs":"2KI","1Chr":"1CH",
  "2Chr":"2CH",Ezra:"EZR",Neh:"NEH",Esth:"EST",Job:"JOB",Ps:"PSA",Prov:"PRO",
  Eccl:"ECC",Song:"SNG",Isa:"ISA",Jer:"JER",Lam:"LAM",Ezek:"EZK",Dan:"DAN",
  Hos:"HOS",Joel:"JOL",Amos:"AMO",Obad:"OBA",Jonah:"JON",Mic:"MIC",Nah:"NAH",
  Hab:"HAB",Zeph:"ZEP",Hag:"HAG",Zech:"ZEC",Mal:"MAL",Matt:"MAT",Mark:"MRK",
  Luke:"LUK",John:"JHN",Acts:"ACT",Rom:"ROM","1Cor":"1CO","2Cor":"2CO",Gal:"GAL",
  Eph:"EPH",Phil:"PHP",Col:"COL","1Thess":"1TH","2Thess":"2TH","1Tim":"1TI",
  "2Tim":"2TI",Titus:"TIT",Phlm:"PHM",Heb:"HEB",Jas:"JAS","1Pet":"1PE",
  "2Pet":"2PE","1John":"1JN","2John":"2JN","3John":"3JN",Jude:"JUD",Rev:"REV",
};

function osisRefToUsfm(ref: string): string {
  // Handles "Book.ch.v" and "Book.ch.v-Book.ch.v" ranges
  return ref.replace(/([A-Za-z0-9]+)(?=\.\d)/g, (book) => OSIS_TO_USFM[book] ?? book);
}

async function fetchFromApiBible(
  apiKey: string,
  bibleId: string,
  osisRef: string
): Promise<{ text: string; translation: string } | null> {
  const passageId = encodeURIComponent(osisRefToUsfm(osisRef));
  const url = `https://rest.api.bible/v1/bibles/${encodeURIComponent(bibleId)}/passages/${passageId}?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true`;

  const res = await fetch(url, {
    headers: { "api-key": apiKey },
    cache: "no-store", // api key is in header — Next.js cache key is URL-only, so caching would serve stale responses after key changes
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new Error("unauthorized"), { code: "bad_api_key" });
    }
    throw new Error(`api.bible responded ${res.status}`);
  }

  const data = await res.json();
  const rawText: string = data?.data?.content ?? "";
  // Strip residual HTML tags and collapse whitespace
  const text = rawText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;

  return { text, translation: bibleId };
}

// ─── OSIS range parser ─────────────────────────────────────────────────────────

interface ParsedOsisRange {
  book: string;
  chapter: number;
  verse: number | undefined;
  endBook: string | undefined;
  endChapter: number | undefined;
  endVerse: number | undefined;
}

function parseOsisRange(ref: string): ParsedOsisRange | null {
  // Possible forms: "Gen.1", "Gen.1.1", "Gen.1.1-Gen.1.3", "Gen.1.1-Gen.2.3"
  const rangeParts = ref.split("-");
  const start = rangeParts[0].split(".");
  const end = rangeParts[1]?.split(".");

  if (start.length < 2) return null;

  const book = start[0];
  const chapter = parseInt(start[1], 10);
  const verse = start[2] !== undefined ? parseInt(start[2], 10) : undefined;

  const endBook = end?.[0];
  const endChapter = end?.[1] !== undefined ? parseInt(end[1], 10) : undefined;
  const endVerse = end?.[2] !== undefined ? parseInt(end[2], 10) : undefined;

  if (isNaN(chapter)) return null;

  return { book, chapter, verse, endBook, endChapter, endVerse };
}
