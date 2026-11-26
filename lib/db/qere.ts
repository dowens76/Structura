/**
 * Masoretic Qere readings (OSHB only), stored in oshb.db's `qere_readings`
 * table by scripts/import-oshb-qere.ts.
 *
 * A Qere is not a row in `words` — it hangs off its Ketiv word — but it has
 * its own stable OSHB word id (e.g. "02iJj"), so it can be selected, tagged
 * and matched by lemma just like an ordinary word. Everything here maps a
 * Qere back to its Ketiv for location (book/chapter/verse).
 */
import { and, asc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { getOshbDb } from "./index";
import { books, words, qereReadings } from "./source-schema";
import type { Word, QereWord } from "./source-schema";
import { parseOshbMorph } from "@/lib/morphology/oshb-parser";
import { transliterateHebrew } from "@/lib/transliteration/hebrew-sbl";

type QereRow = typeof qereReadings.$inferSelect;

let _hasTable: boolean | null = null;

/** False for an older oshb.db built before the Qere import existed. */
export function oshbHasQere(): boolean {
  if (_hasTable === null) {
    const rows = getOshbDb().all<{ n: number }>(
      sql`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'qere_readings'`
    );
    _hasTable = (rows[0]?.n ?? 0) > 0;
  }
  return _hasTable;
}

const CHUNK = 500;

/** Build a full Word for a Qere, taking its location from the Ketiv. */
export function qereToWord(r: QereRow, ketiv: Word): QereWord {
  const m = r.morphCode ? parseOshbMorph(r.morphCode, r.surfaceText) : null;
  const plain = r.surfaceText.replace(/\//g, "");
  let translit: string | null = null;
  try { translit = transliterateHebrew(plain) || null; } catch { /* leave null */ }
  return {
    id:              -r.id,
    wordId:          r.wordId,
    bookId:          ketiv.bookId,
    chapter:         ketiv.chapter,
    verse:           ketiv.verse,
    positionInVerse: ketiv.positionInVerse,
    surfaceText:     r.surfaceText,
    surfaceNorm:     r.surfaceText.replace(/[֑-ֽ֯-ׇ]/g, "").trim() || null,
    largeLetters:    null,
    lemma:           r.lemma,
    strongNumber:    r.strongNumber,
    morphCode:       r.morphCode,
    transliteration: translit,
    partOfSpeech:    m?.partOfSpeech ?? null,
    person:          m?.person ?? null,
    gender:          m?.gender ?? null,
    wordNumber:      m?.wordNumber ?? null,
    tense:           m?.tense ?? null,
    voice:           m?.voice ?? null,
    mood:            m?.mood ?? null,
    stem:            m?.stem ?? null,
    state:           m?.state ?? null,
    verbCase:        m?.verbCase ?? null,
    language:        ketiv.language,
    textSource:      ketiv.textSource,
    kind:            r.kind === "qere-only" ? "qere-only" : "qere",
    ketivWordId:     r.ketivWordId,
  };
}

/** Attach each Ketiv word's Qere words. No-op for other sources. */
export async function attachQere(ws: Word[], textSource: string): Promise<Word[]> {
  if (textSource !== "OSHB" || ws.length === 0 || !oshbHasQere()) return ws;
  const db = getOshbDb();
  const byKetiv = new Map<string, QereRow[]>();
  const ids = ws.map((w) => w.wordId);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await db.select().from(qereReadings)
      .where(inArray(qereReadings.ketivWordId, ids.slice(i, i + CHUNK)))
      .orderBy(asc(qereReadings.ketivWordId), asc(qereReadings.seq));
    for (const r of rows) {
      const list = byKetiv.get(r.ketivWordId) ?? [];
      list.push(r);
      byKetiv.set(r.ketivWordId, list);
    }
  }
  if (byKetiv.size === 0) return ws;
  return ws.map((w) => {
    const q = byKetiv.get(w.wordId);
    return q ? { ...w, qere: q.map((r) => qereToWord(r, w)) } : w;
  });
}

/** Lemma search over Qere words: same matching as getWordRefsByLemmas
 *  (exact Strong's for "H123"-style queries, substring on lemma otherwise),
 *  located by the Ketiv's book/chapter. */
export async function getQereRefsByLemmas(
  lemmas: string[],
  corpusBooks: string[],
): Promise<Array<{ wordId: string; book: string; chapter: number; textSource: string }>> {
  if (lemmas.length === 0 || corpusBooks.length === 0 || !oshbHasQere()) return [];
  const conds: SQL[] = lemmas.map((q) =>
    /^[HG]\d+[a-z]?$/.test(q) ? eq(qereReadings.strongNumber, q) : like(qereReadings.lemma, `%${q}%`)
  );
  const rows = await getOshbDb()
    .select({ wordId: qereReadings.wordId, osisCode: books.osisCode, chapter: words.chapter })
    .from(qereReadings)
    .innerJoin(words, eq(words.wordId, qereReadings.ketivWordId))
    .innerJoin(books, eq(words.bookId, books.id))
    .where(and(inArray(books.osisCode, corpusBooks), conds.length === 1 ? conds[0] : or(...conds)));
  return rows.map((r) => ({ wordId: r.wordId, book: r.osisCode, chapter: r.chapter, textSource: "OSHB" }));
}

/** Resolve Qere word ids to their Ketiv's chapter/verse (for refs that
 *  aren't rows in `words`). */
export async function getQereLocations(
  qereWordIds: string[],
): Promise<Map<string, { ketivWordId: string; chapter: number; verse: number }>> {
  const out = new Map<string, { ketivWordId: string; chapter: number; verse: number }>();
  if (qereWordIds.length === 0 || !oshbHasQere()) return out;
  const db = getOshbDb();
  for (let i = 0; i < qereWordIds.length; i += CHUNK) {
    const rows = await db
      .select({ wordId: qereReadings.wordId, ketivWordId: qereReadings.ketivWordId, chapter: words.chapter, verse: words.verse })
      .from(qereReadings)
      .innerJoin(words, eq(words.wordId, qereReadings.ketivWordId))
      .where(inArray(qereReadings.wordId, qereWordIds.slice(i, i + CHUNK)));
    for (const r of rows) out.set(r.wordId, { ketivWordId: r.ketivWordId, chapter: r.chapter, verse: r.verse });
  }
  return out;
}

/** All Qere words in one chapter, keyed by Ketiv word id, in reading order. */
export async function getChapterQere(bookId: number, chapter: number): Promise<Map<string, { wordId: string; surfaceText: string; kind: string }[]>> {
  const out = new Map<string, { wordId: string; surfaceText: string; kind: string }[]>();
  if (!oshbHasQere()) return out;
  const rows = await getOshbDb()
    .select({ ketivWordId: qereReadings.ketivWordId, wordId: qereReadings.wordId, surfaceText: qereReadings.surfaceText, kind: qereReadings.kind })
    .from(qereReadings)
    .innerJoin(words, eq(words.wordId, qereReadings.ketivWordId))
    .where(and(eq(words.bookId, bookId), eq(words.chapter, chapter)))
    .orderBy(asc(qereReadings.ketivWordId), asc(qereReadings.seq));
  for (const r of rows) {
    const list = out.get(r.ketivWordId) ?? [];
    list.push(r);
    out.set(r.ketivWordId, list);
  }
  return out;
}
