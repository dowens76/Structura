export interface ParsedMorphology {
  partOfSpeech: string | null;
  // Verb features
  stem: string | null;     // Hebrew: qal, niphal, piel, etc.
  tense: string | null;    // Greek: aorist, present, perfect, etc.
  voice: string | null;    // Greek: active, middle, passive
  mood: string | null;     // Greek: indicative, subjunctive, imperative, infinitive, participle, optative
  person: string | null;   // 1, 2, 3
  // Nominal features
  gender: string | null;   // masculine, feminine, neuter, common
  wordNumber: string | null; // singular, plural, dual
  verbCase: string | null; // Greek: nominative, genitive, dative, accusative, vocative
  state: string | null;    // Hebrew: absolute, construct, determined
  // Prefix info (Hebrew)
  prefixes: string[];
}

export interface WordData {
  id: number;
  wordId: string;
  osisRef: string;
  bookId: number;
  chapter: number;
  verse: number;
  positionInVerse: number;
  surfaceText: string;
  surfaceNorm: string | null;
  lemma: string | null;
  strongNumber: string | null;
  morphCode: string | null;
  partOfSpeech: string | null;
  person: string | null;
  gender: string | null;
  wordNumber: string | null;
  tense: string | null;
  voice: string | null;
  mood: string | null;
  stem: string | null;
  state: string | null;
  verbCase: string | null;
  language: string;
  textSource: string;
}

export type Language = "hebrew" | "greek";
export type TextSource = "OSHB" | "SBLGNT" | "STEPBIBLE_LXX";
export type Testament = "OT" | "NT" | "LXX";

export type DisplayMode = "clean" | "color" | "interlinear";

export interface TranslationTextEntry {
  abbr: string;
  text: string;
}

export interface GrammarFilterState {
  noun: boolean;
  verb: boolean;
  adjective: boolean;
  adverb: boolean;
  preposition: boolean;
  conjunction: boolean;
  pronoun: boolean;
  particle: boolean;
  article: boolean;
  interjection: boolean;
}

export const POS_COLORS: Record<string, string> = {
  noun: "#3b82f6",        // blue
  verb: "#ef4444",        // red
  adjective: "#22c55e",   // green
  adverb: "#f59e0b",      // amber
  preposition: "#8b5cf6", // purple
  conjunction: "#6b7280", // gray
  pronoun: "#ec4899",     // pink
  particle: "#64748b",    // slate
  article: "#14b8a6",     // teal
  interjection: "#f97316",// orange
};

// Maps descriptive Hebrew aspect names → standard linguistic terms
export const LINGUISTIC_TENSE_MAP: Record<string, string> = {
  "perfect":              "Qatal",
  "imperfect":            "Yiqtol",
  "sequential imperfect": "Wayyiqtol",
  "sequential perfect":   "Weqatal",
};

/**
 * Returns the tense/aspect label to display.
 * When `linguistic` is true, substitutes Qatal/Yiqtol/Wayyiqtol/Weqatal
 * for the four corresponding Hebrew aspect terms.
 */
export function formatTense(tense: string | null, linguistic: boolean): string | null {
  if (!tense) return null;
  if (!linguistic) return tense;
  return LINGUISTIC_TENSE_MAP[tense] ?? tense;
}

export const POS_LABELS: Record<string, string> = {
  noun: "Noun",
  verb: "Verb",
  adjective: "Adjective",
  adverb: "Adverb",
  preposition: "Preposition",
  conjunction: "Conjunction",
  pronoun: "Pronoun",
  particle: "Particle",
  article: "Article",
  interjection: "Interjection",
};
