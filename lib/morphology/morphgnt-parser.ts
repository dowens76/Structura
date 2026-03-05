/**
 * Parser for MorphGNT morphology codes (used with SBLGNT).
 *
 * POS codes (2 chars): N-, V-, A-, D-, P-, C-, RA, RD, RI, RP, RR, X-, I-
 * Parse code (8 chars): [Person][Tense][Voice][Mood][Case][Number][Gender][-]
 *   [0] Person: 1, 2, 3, -
 *   [1] Tense:  P=present, I=imperfect, F=future, A=aorist, R=perfect, X=pluperfect, -
 *   [2] Voice:  A=active, M=middle, P=passive, -
 *   [3] Mood:   I=indicative, D=imperative, S=subjunctive, O=optative, N=infinitive, P=participle, -
 *   [4] Case:   N=nominative, G=genitive, D=dative, A=accusative, V=vocative, -
 *   [5] Number: S=singular, P=plural, -
 *   [6] Gender: M=masculine, F=feminine, N=neuter, -
 *   [7] (unused, always -)
 *
 * Examples:
 *   "3AAI-S--" = 3rd person Aorist Active Indicative Singular (verb)
 *   "----NSF-" = Nominative Singular Feminine (noun/adjective)
 *
 * Reference: https://morphgnt.org/
 */

import type { ParsedMorphology } from "./types";

const TENSE_MAP: Record<string, string> = {
  P: "present", I: "imperfect", F: "future", A: "aorist",
  R: "perfect", X: "pluperfect",
};

const VOICE_MAP: Record<string, string> = {
  A: "active", M: "middle", P: "passive",
};

const MOOD_MAP: Record<string, string> = {
  I: "indicative", D: "imperative", S: "subjunctive",
  O: "optative", N: "infinitive", P: "participle",
};

const NUMBER_MAP: Record<string, string> = {
  S: "singular", P: "plural",
};

const GENDER_MAP: Record<string, string> = {
  M: "masculine", F: "feminine", N: "neuter",
};

const CASE_MAP: Record<string, string> = {
  N: "nominative", G: "genitive", D: "dative", A: "accusative", V: "vocative",
};

const POS_MAP: Record<string, string> = {
  "N-": "noun",
  "V-": "verb",
  "A-": "adjective",
  "D-": "adverb",
  "P-": "preposition",
  "C-": "conjunction",
  "RA": "article",
  "RD": "demonstrative pronoun",
  "RI": "interrogative pronoun",
  "RP": "personal pronoun",
  "RR": "relative pronoun",
  "X-": "particle",
  "I-": "interjection",
};

export function parseMorphgntCode(posCode: string, parseCode: string): ParsedMorphology {
  const result: ParsedMorphology = {
    partOfSpeech: POS_MAP[posCode] ?? null,
    stem: null,
    tense: null, voice: null, mood: null, person: null,
    gender: null, wordNumber: null, verbCase: null, state: null,
    prefixes: [],
  };

  if (!parseCode || parseCode.length < 7) return result;

  const chars = parseCode.split("");
  const [person, tense, voice, mood, kase, number, gender] = chars;

  if (person !== "-") result.person = person;
  if (tense !== "-") result.tense = TENSE_MAP[tense] ?? null;
  if (voice !== "-") result.voice = VOICE_MAP[voice] ?? null;
  if (mood !== "-") result.mood = MOOD_MAP[mood] ?? null;
  if (kase !== "-") result.verbCase = CASE_MAP[kase] ?? null;
  if (number !== "-") result.wordNumber = NUMBER_MAP[number] ?? null;
  if (gender !== "-") result.gender = GENDER_MAP[gender] ?? null;

  return result;
}

/** MorphGNT file prefix → OSIS book code */
export const MORPHGNT_FILES: Array<{ prefix: string; filename: string; osisCode: string }> = [
  { prefix: "61", filename: "61-Mt-morphgnt.txt", osisCode: "Matt" },
  { prefix: "62", filename: "62-Mk-morphgnt.txt", osisCode: "Mark" },
  { prefix: "63", filename: "63-Lk-morphgnt.txt", osisCode: "Luke" },
  { prefix: "64", filename: "64-Jn-morphgnt.txt", osisCode: "John" },
  { prefix: "65", filename: "65-Ac-morphgnt.txt", osisCode: "Acts" },
  { prefix: "66", filename: "66-Ro-morphgnt.txt", osisCode: "Rom" },
  { prefix: "67", filename: "67-1Co-morphgnt.txt", osisCode: "1Cor" },
  { prefix: "68", filename: "68-2Co-morphgnt.txt", osisCode: "2Cor" },
  { prefix: "69", filename: "69-Ga-morphgnt.txt", osisCode: "Gal" },
  { prefix: "70", filename: "70-Eph-morphgnt.txt", osisCode: "Eph" },
  { prefix: "71", filename: "71-Php-morphgnt.txt", osisCode: "Phil" },
  { prefix: "72", filename: "72-Col-morphgnt.txt", osisCode: "Col" },
  { prefix: "73", filename: "73-1Th-morphgnt.txt", osisCode: "1Thess" },
  { prefix: "74", filename: "74-2Th-morphgnt.txt", osisCode: "2Thess" },
  { prefix: "75", filename: "75-1Ti-morphgnt.txt", osisCode: "1Tim" },
  { prefix: "76", filename: "76-2Ti-morphgnt.txt", osisCode: "2Tim" },
  { prefix: "77", filename: "77-Tit-morphgnt.txt", osisCode: "Titus" },
  { prefix: "78", filename: "78-Phm-morphgnt.txt", osisCode: "Phlm" },
  { prefix: "79", filename: "79-Heb-morphgnt.txt", osisCode: "Heb" },
  { prefix: "80", filename: "80-Jas-morphgnt.txt", osisCode: "Jas" },
  { prefix: "81", filename: "81-1Pe-morphgnt.txt", osisCode: "1Pet" },
  { prefix: "82", filename: "82-2Pe-morphgnt.txt", osisCode: "2Pet" },
  { prefix: "83", filename: "83-1Jn-morphgnt.txt", osisCode: "1John" },
  { prefix: "84", filename: "84-2Jn-morphgnt.txt", osisCode: "2John" },
  { prefix: "85", filename: "85-3Jn-morphgnt.txt", osisCode: "3John" },
  { prefix: "86", filename: "86-Jud-morphgnt.txt", osisCode: "Jude" },
  { prefix: "87", filename: "87-Re-morphgnt.txt", osisCode: "Rev" },
];
