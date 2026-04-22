/**
 * Parser for LXX (Rahlfs-1935 via eliranwong/LXX-Rahlfs-1935) morphology codes.
 *
 * Format: "POS.features" e.g. "N.DSF", "V.AAI3S", "RA.NSM", "P"
 *
 * POS codes: N, V, A, D, P, C, RA, RP, RR, RD, RI, I
 *
 * Verbal features: [Tense][Voice][Mood][Person][Number] for finite verbs
 *                  [Tense][Voice][Mood][Case][Number][Gender] for participles
 * Nominal features: [Case][Number][Gender]
 */

import type { ParsedMorphology } from "./types";

const POS_MAP: Record<string, string> = {
  N: "noun", V: "verb", A: "adjective", D: "adverb",
  P: "preposition", C: "conjunction",
  RA: "article", RP: "personal pronoun", RR: "relative pronoun",
  RD: "demonstrative pronoun", RI: "interrogative pronoun",
  I: "interjection", X: "particle",
};

const TENSE_MAP: Record<string, string> = {
  P: "present", I: "imperfect", F: "future", A: "aorist",
  R: "perfect", L: "pluperfect", X: "perfect", Y: "pluperfect",
};

const VOICE_MAP: Record<string, string> = {
  A: "active", M: "middle", P: "passive",
};

const MOOD_MAP: Record<string, string> = {
  I: "indicative", D: "imperative", S: "subjunctive",
  O: "optative", N: "infinitive", P: "participle",
};

const CASE_MAP: Record<string, string> = {
  N: "nominative", G: "genitive", D: "dative", A: "accusative", V: "vocative",
};

const NUMBER_MAP: Record<string, string> = {
  S: "singular", P: "plural", D: "dual",
};

const GENDER_MAP: Record<string, string> = {
  M: "masculine", F: "feminine", N: "neuter",
};

export function parseLxxMorph(morphCode: string): ParsedMorphology {
  const result: ParsedMorphology = {
    partOfSpeech: null, stem: null, tense: null, voice: null,
    mood: null, person: null, gender: null, wordNumber: null,
    verbCase: null, state: null, prefixes: [],
  };

  if (!morphCode) return result;

  const dotIdx = morphCode.indexOf(".");
  const posCode = dotIdx === -1 ? morphCode : morphCode.slice(0, dotIdx);
  const features = dotIdx === -1 ? "" : morphCode.slice(dotIdx + 1);

  result.partOfSpeech = POS_MAP[posCode] ?? null;

  if (!features) return result;

  if (posCode === "V") {
    result.tense = TENSE_MAP[features[0]] ?? null;
    result.voice = VOICE_MAP[features[1]] ?? null;
    result.mood = MOOD_MAP[features[2]] ?? null;
    if (result.mood === "participle") {
      // Participle: [T][V][M][Case][Number][Gender]
      result.verbCase = CASE_MAP[features[3]] ?? null;
      result.wordNumber = NUMBER_MAP[features[4]] ?? null;
      result.gender = GENDER_MAP[features[5]] ?? null;
    } else {
      // Finite verb: [T][V][M][Person][Number]
      result.person = ["1", "2", "3"].includes(features[3]) ? features[3] : null;
      result.wordNumber = NUMBER_MAP[features[4]] ?? null;
    }
  } else {
    // Nominal: [Case][Number][Gender]
    result.verbCase = CASE_MAP[features[0]] ?? null;
    result.wordNumber = NUMBER_MAP[features[1]] ?? null;
    result.gender = GENDER_MAP[features[2]] ?? null;
  }

  return result;
}
