/**
 * Parser for Open Scriptures Hebrew Bible (OSHB) morphology codes.
 * Format: H[prefix/prefix/...]MainMorphology
 * Example: "HC/Ncmsa" = Hebrew, Conjunction prefix, Noun common masculine singular absolute
 *
 * Reference: https://github.com/openscriptures/morphhb/blob/master/parsing/HebrewMorphologyCodes.md
 */

import type { ParsedMorphology, PrefixInfo } from "./types";

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
  p: "perfect", q: "sequential perfect",
  i: "imperfect", w: "sequential imperfect",
  h: "cohortative", j: "jussive", v: "imperative",
  r: "active participle", s: "passive participle",
  a: "infinitive absolute", c: "infinitive construct",
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

// Bound-prefix morph codes (e.g. "C", "R", "Td") only say the prefix's
// grammatical category, not which Hebrew letter was actually used — "R"
// (preposition) covers ב/כ/ל/מ indiscriminately. The real letter has to be
// read off the word's own surface text (see resolvePrefixLetter below) and
// mapped here to its BDB lexicon entry (scripts/import-bdb.ts's letter-keyed
// particle rows: b, c, d, i, k, l, m, s).
const PREFIX_CONSONANT_MAP: Record<string, { label: string; lexiconKey: string }> = {
  "ו": { label: "conjunction (ו)",       lexiconKey: "c" },
  "ב": { label: "preposition (ב)",       lexiconKey: "b" },
  "כ": { label: "preposition (כ)",       lexiconKey: "k" },
  "ל": { label: "preposition (ל)",       lexiconKey: "l" },
  "מ": { label: "preposition (מ)",       lexiconKey: "m" },
  "ה": { label: "definite article (ה)",  lexiconKey: "d" },
  "ש": { label: "relative pronoun (ש)",  lexiconKey: "s" },
};

// Fallback label (no lexicon link) when surface text isn't available to
// resolve the exact letter, or for rare/ambiguous prefix codes.
const PREFIX_CODE_FALLBACK: Record<string, string> = {
  C: "conjunction", R: "preposition", T: "definite article",
  N: "negative particle", D: "adverb", P: "pronoun",
};

/** Strip Hebrew niqqud/cantillation marks (U+0591–05C7) to expose bare consonants. */
function stripNiqqud(s: string): string {
  return s.replace(/[֑-ׇ]/g, "");
}

function resolvePrefixInfo(code: string, surfacePart: string | undefined): PrefixInfo {
  const consonant = surfacePart ? stripNiqqud(surfacePart)[0] : undefined;
  const known = consonant ? PREFIX_CONSONANT_MAP[consonant] : undefined;
  if (known) {
    // "Rd" = preposition with the definite article assimilated/invisible in
    // the text (e.g. בָּ = ב + ה). The article has no separate visible
    // morpheme to link, so just note it alongside the preposition's own entry.
    const hasFusedArticle = code[0] === "R" && code[1] === "d";
    return {
      code,
      label: hasFusedArticle ? `${known.label} + definite article` : known.label,
      lexiconKey: known.lexiconKey,
    };
  }
  return { code, label: PREFIX_CODE_FALLBACK[code[0]] ?? code, lexiconKey: null };
}

const SUFFIX_TYPE_MAP: Record<string, string> = {
  p: "pronominal suffix",
  d: "directional",
  h: "paragogic he",
  n: "paragogic nun",
};

export function parseOshbMorph(morphCode: string, surfaceText?: string | null): ParsedMorphology {
  const result: ParsedMorphology = {
    partOfSpeech: null, stem: null, tense: null, voice: null,
    mood: null, person: null, gender: null, wordNumber: null,
    verbCase: null, state: null, prefixes: [], rootSurface: null,
    suffixType: null, suffixPerson: null, suffixGender: null, suffixNumber: null,
  };

  if (!morphCode || morphCode === "NONE") return result;

  // Strip leading 'H' (Hebrew) or 'A' (Aramaic) language marker
  let code = (morphCode.startsWith("H") || morphCode.startsWith("A"))
    ? morphCode.slice(1)
    : morphCode;

  // Split into morpheme parts on '/'.
  // Structure: [prefix…] / main / [suffix…]
  // Suffix morphemes always start with 'S' and come last.
  // The main morpheme is the last non-suffix (non-'S') part.
  const parts = code.split("/");

  // Walk backwards to separate suffix parts from the main morpheme.
  let mainIdx = parts.length - 1;
  while (mainIdx > 0 && parts[mainIdx].startsWith("S")) {
    mainIdx--;
  }

  const mainPart = parts[mainIdx] ?? "";
  const prefixParts = parts.slice(0, mainIdx);
  const suffixParts = parts.slice(mainIdx + 1);

  // surface_text's morphemes line up 1:1 with the morph code's parts (split
  // on "/"), so slicing it the same way gives the actual Hebrew text for
  // each prefix and for the root/main morpheme itself.
  const surfaceParts = surfaceText ? surfaceText.split("/") : [];
  const surfacePrefixParts = surfaceParts.slice(0, prefixParts.length);
  result.prefixes = prefixParts
    .map((p, idx) => resolvePrefixInfo(p, surfacePrefixParts[idx]))
    .filter((p) => p.label);
  result.rootSurface = surfaceParts[mainIdx] ?? null;

  // Decode suffix morphemes — prioritise the pronominal suffix (type 'p') for
  // person/gender/number; record the first suffix type found.
  for (const suf of suffixParts) {
    if (suf.length < 2) continue;
    const sufType = suf[1]; // e.g. 'p', 'd', 'h', 'n'
    if (!result.suffixType) {
      result.suffixType = SUFFIX_TYPE_MAP[sufType] ?? null;
    }
    if (sufType === "p") {
      // Sp[person][gender][number]
      result.suffixPerson = ["1", "2", "3"].includes(suf[2]) ? suf[2] : null;
      result.suffixGender = GENDER_MAP[suf[3]] ?? null;
      result.suffixNumber = NUMBER_MAP[suf[4]] ?? null;
      break; // pronominal suffix carries the richest info; stop here
    }
  }

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

    case "V": { // Verb
      result.partOfSpeech = "verb";
      result.stem = STEM_MAP[rest[0]] ?? rest[0] ?? null;
      const aspect = rest[1] ?? "";
      result.tense = ASPECT_MAP[aspect] ?? aspect ?? null;

      if (aspect === "r" || aspect === "s") {
        // Participles (active/passive): V[stem][r/s][gender][number][state]
        // No person field — participles behave like verbal adjectives.
        result.gender = GENDER_MAP[rest[2]] ?? null;
        result.wordNumber = NUMBER_MAP[rest[3]] ?? null;
        result.state = STATE_MAP[rest[4]] ?? null;
      } else if (aspect === "a" || aspect === "c") {
        // Infinitives: V[stem][a/c] — no person/gender/number fields
      } else {
        // Finite verbs (perfect, sequential perfect, imperfect, sequential
        // imperfect, cohortative, jussive, imperative):
        // V[stem][aspect][person][gender][number]
        result.person = ["1", "2", "3"].includes(rest[2]) ? rest[2] : null;
        result.gender = GENDER_MAP[rest[3]] ?? null;
        result.wordNumber = NUMBER_MAP[rest[4]] ?? null;
      }
      break;
    }

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
