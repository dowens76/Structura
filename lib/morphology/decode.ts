/**
 * Dispatch morphology parsing based on the word's text source.
 * Always re-parses from the raw morphCode so the display is correct
 * even if the DB-stored parsed fields are stale.
 */

import type { Word } from "@/lib/db/schema";
import type { ParsedMorphology } from "./types";
import { parseOshbMorph } from "./oshb-parser";
import { parseMorphgntCode } from "./morphgnt-parser";
import { parseLxxMorph } from "./lxx-parser";

const EMPTY: ParsedMorphology = {
  partOfSpeech: null, stem: null, tense: null, voice: null,
  mood: null, person: null, gender: null, wordNumber: null,
  verbCase: null, state: null, prefixes: [],
};

export function getMorphology(word: Word): ParsedMorphology {
  if (!word.morphCode) return EMPTY;

  if (word.textSource === "OSHB") {
    return parseOshbMorph(word.morphCode);
  }

  if (word.textSource === "SBLGNT") {
    const spaceIdx = word.morphCode.indexOf(" ");
    if (spaceIdx === -1) return EMPTY;
    const posCode = word.morphCode.slice(0, spaceIdx);
    const parseCode = word.morphCode.slice(spaceIdx + 1);
    return parseMorphgntCode(posCode, parseCode);
  }

  if (word.textSource === "STEPBIBLE_LXX") {
    return parseLxxMorph(word.morphCode);
  }

  return EMPTY;
}
