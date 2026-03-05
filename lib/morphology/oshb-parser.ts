/**
 * Parser for Open Scriptures Hebrew Bible (OSHB) morphology codes.
 * Format: H[prefix/prefix/...]MainMorphology
 * Example: "HC/Ncmsa" = Hebrew, Conjunction prefix, Noun common masculine singular absolute
 *
 * Reference: https://github.com/openscriptures/morphhb/blob/master/parsing/HebrewMorphologyCodes.md
 */

import type { ParsedMorphology } from "./types";

const STEM_MAP: Record<string, string> = {
  q: "qal", N: "niphal", p: "piel", P: "pual",
  h: "hiphil", H: "hophal", t: "hithpael",
  o: "polel", O: "polal", r: "hithpolel",
  m: "poel", M: "poal", k: "palel", K: "pulal",
  Q: "qal passive", l: "pilpel", L: "polpal",
  f: "hithpalpel", D: "nithpael", j: "pealal",
  i: "pilel", u: "hothpaal", c: "tiphil",
  v: "hishtaphel", w: "nithpolel", y: "nithpael",
  z: "hithpoel",
};

const ASPECT_MAP: Record<string, string> = {
  p: "perfect", i: "imperfect", w: "sequential imperfect",
  q: "sequential perfect", v: "volitional", r: "participle",
  s: "imperative", a: "infinitive absolute", c: "infinitive construct",
};

const GENDER_MAP: Record<string, string> = {
  m: "masculine", f: "feminine", c: "common", b: "both",
};

const NUMBER_MAP: Record<string, string> = {
  s: "singular", p: "plural", d: "dual",
};

const STATE_MAP: Record<string, string> = {
  a: "absolute", c: "construct", d: "determined",
};

const PREFIX_MAP: Record<string, string> = {
  A: "adjective prefix", C: "conjunction", D: "definite article",
  N: "negative particle", P: "pronoun", R: "relative pronoun",
  S: "preposition", T: "particle", b: "preposition (ב)",
  c: "conjunction (ו)", d: "definite article", i: "preposition (ל)",
  k: "preposition (כ)", l: "preposition (ל)", m: "preposition (מ)",
  s: "preposition (ש)",
};

export function parseOshbMorph(morphCode: string): ParsedMorphology {
  const result: ParsedMorphology = {
    partOfSpeech: null, stem: null, tense: null, voice: null,
    mood: null, person: null, gender: null, wordNumber: null,
    verbCase: null, state: null, prefixes: [],
  };

  if (!morphCode || morphCode === "NONE") return result;

  // Strip leading 'H' language marker
  let code = morphCode.startsWith("H") ? morphCode.slice(1) : morphCode;

  // Split on '/' to get prefix parts and main morphology
  const parts = code.split("/");
  const mainPart = parts[parts.length - 1];
  const prefixParts = parts.slice(0, -1);

  // Decode prefixes
  result.prefixes = prefixParts.map((p) => PREFIX_MAP[p[0]] ?? p).filter(Boolean);

  if (!mainPart) return result;

  const posChar = mainPart[0];
  const rest = mainPart.slice(1);

  switch (posChar) {
    case "N": // Noun — format: [type][gender][number][state]
      result.partOfSpeech = "noun";
      // rest[0] = noun type: c=common, p=proper, g=gentilic (skip for display)
      result.gender = GENDER_MAP[rest[1]] ?? null;
      result.wordNumber = NUMBER_MAP[rest[2]] ?? null;
      result.state = STATE_MAP[rest[3]] ?? null;
      break;

    case "V": // Verb
      result.partOfSpeech = "verb";
      result.stem = STEM_MAP[rest[0]] ?? rest[0] ?? null;
      result.tense = ASPECT_MAP[rest[1]] ?? rest[1] ?? null;
      result.person = ["1", "2", "3"].includes(rest[2]) ? rest[2] : null;
      result.gender = GENDER_MAP[rest[3]] ?? null;
      result.wordNumber = NUMBER_MAP[rest[4]] ?? null;
      // State for participles
      if (rest[5]) result.state = STATE_MAP[rest[5]] ?? null;
      break;

    case "A": // Adjective — format: [type][gender][number][state]
      result.partOfSpeech = "adjective";
      // rest[0] = adjective type: a=adjective, c=cardinal, o=ordinal, g=gentilic
      result.gender = GENDER_MAP[rest[1]] ?? null;
      result.wordNumber = NUMBER_MAP[rest[2]] ?? null;
      result.state = STATE_MAP[rest[3]] ?? null;
      break;

    case "P": { // Pronoun
      const subtype = rest[0];
      if (subtype === "p") result.partOfSpeech = "personal pronoun";
      else if (subtype === "d") result.partOfSpeech = "demonstrative pronoun";
      else if (subtype === "i") result.partOfSpeech = "interrogative pronoun";
      else if (subtype === "r") result.partOfSpeech = "relative pronoun";
      else result.partOfSpeech = "pronoun";
      result.person = ["1", "2", "3"].includes(rest[1]) ? rest[1] : null;
      result.gender = GENDER_MAP[rest[2]] ?? null;
      result.wordNumber = NUMBER_MAP[rest[3]] ?? null;
      break;
    }

    case "R": // Preposition
      result.partOfSpeech = "preposition";
      break;

    case "C": // Conjunction
      result.partOfSpeech = "conjunction";
      break;

    case "T": { // Particle
      const subtype = rest[0];
      if (subtype === "n") result.partOfSpeech = "negative particle";
      else if (subtype === "e") result.partOfSpeech = "existence particle";
      else result.partOfSpeech = "particle";
      break;
    }

    case "S": { // Suffix
      result.partOfSpeech = "pronominal suffix";
      result.person = ["1", "2", "3"].includes(rest[1]) ? rest[1] : null;
      result.gender = GENDER_MAP[rest[2]] ?? null;
      result.wordNumber = NUMBER_MAP[rest[3]] ?? null;
      break;
    }

    case "D": // Adverb
      result.partOfSpeech = "adverb";
      break;

    case "E": // Interjection
      result.partOfSpeech = "interjection";
      break;

    case "I": // Interjection variant
      result.partOfSpeech = "interjection";
      break;

    case "O": // Punctuation / other
      result.partOfSpeech = "other";
      break;

    default:
      result.partOfSpeech = posChar ? posChar.toLowerCase() : null;
  }

  return result;
}

/** Parse a Strong's lemma string from OSHB (e.g. "7225", "b/7225") → clean H number */
export function parseOshbLemma(lemmaRaw: string): {
  strongNumber: string | null;
  lemmaText: string | null;
} {
  if (!lemmaRaw) return { strongNumber: null, lemmaText: null };
  // OSHB lemmas can be like "c/7225" or "7225" or "7225a"
  const parts = lemmaRaw.split("/");
  const main = parts[parts.length - 1];
  // Strip trailing letters (dictionary variants like '7225a')
  const numMatch = main.match(/^(\d+)/);
  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    return { strongNumber: `H${num}`, lemmaText: main };
  }
  return { strongNumber: null, lemmaText: main };
}
