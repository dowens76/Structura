import {
  getDistinctWordsInScope,
  getCorpusWideWordCounts,
  getBulkLexiconGlosses,
} from "@/lib/db/queries";
import type { TextSource } from "@/lib/morphology/types";

export interface VocabWord {
  key: string;
  lemma: string | null;
  strongNumber: string | null;
  partOfSpeech: string | null;
  gloss: string | null;
  corpusCount: number;
}

export interface VocabScopeParams {
  textSource: TextSource;
  osisBooks: string[];
  chapterStart?: number; // only meaningful when osisBooks.length === 1
  chapterEnd?: number;
  minOccurrences: number;
  maxOccurrences: number | null; // null = no upper bound
}

/**
 * Resolves a vocabulary scope + occurrence filter into the word list the
 * preview/export routes both serialize. Filtering happens before the
 * lexicon lookup (the only step touching a different, more numerous set of
 * DBs) so gloss lookups are only run for words that survive the filter.
 */
export async function resolveVocabularyList(params: VocabScopeParams): Promise<VocabWord[]> {
  const { textSource, osisBooks, chapterStart, chapterEnd, minOccurrences, maxOccurrences } = params;

  const chapterRange =
    osisBooks.length === 1 && chapterStart != null && chapterEnd != null
      ? { start: chapterStart, end: chapterEnd }
      : null;

  const [scopeWords, corpusCounts] = await Promise.all([
    getDistinctWordsInScope(osisBooks, chapterRange, textSource),
    getCorpusWideWordCounts(textSource),
  ]);

  const filtered = scopeWords
    .map((w) => ({ ...w, corpusCount: corpusCounts.get(w.key) ?? 0 }))
    .filter((w) => w.corpusCount >= minOccurrences && (maxOccurrences == null || w.corpusCount <= maxOccurrences));

  const language = textSource === "OSHB" ? "hebrew" : "greek";
  const keyType = textSource === "OSHB" ? "strongNumber" : "lemma";
  const glosses = await getBulkLexiconGlosses(
    filtered.map((w) => w.key),
    language,
    keyType,
  );

  return filtered
    .map((w) => ({
      key:          w.key,
      // Prefer the lexicon's own headword: OSHB's words.lemma is actually a
      // raw Strong's-number-derived string (e.g. "5921 a"), not real Hebrew
      // script — the lexicon entry has the real headword. Greek's
      // words.lemma is already the real lemma, so this just confirms it.
      lemma:        glosses.get(w.key)?.lemma ?? w.lemma,
      strongNumber: w.strongNumber,
      partOfSpeech: w.partOfSpeech,
      // Source gloss text sometimes carries raw line-wrap whitespace/newlines
      // from the original HTML (harmless in styled HTML views, but ugly in a
      // plain table cell, CSV field, or flashcard) — collapse it here.
      gloss:        glosses.get(w.key)?.shortGloss?.replace(/\s+/g, " ").trim() ?? null,
      corpusCount:  w.corpusCount,
    }))
    .sort((a, b) => b.corpusCount - a.corpusCount);
}
