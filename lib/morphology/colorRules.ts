import type { Word } from "@/lib/db/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RuleConditions {
  partOfSpeech?: string[]; // broad keys: "verb", "noun", etc.
  stem?: string[];
  tense?: string[];
  voice?: string[];
  mood?: string[];
  person?: string[];
  gender?: string[];
  wordNumber?: string[];
  verbCase?: string[];
  state?: string[];
}

export interface ColorRule {
  id: string;
  label: string;     // auto-generated from conditions
  color: string;     // hex
  conditions: RuleConditions;
}

// ── POS normalisation ─────────────────────────────────────────────────────────

/**
 * Maps a raw partOfSpeech string (e.g. "personal pronoun") to its broad key
 * (e.g. "pronoun") used throughout the filter/color system.
 */
export function getPosKey(pos: string | null): string | null {
  if (!pos) return null;
  if (pos.includes("noun")) return "noun";
  if (pos.includes("verb")) return "verb";
  if (pos.includes("adjective")) return "adjective";
  if (pos.includes("adverb")) return "adverb";
  if (pos.includes("preposition")) return "preposition";
  if (pos.includes("conjunction")) return "conjunction";
  if (pos.includes("pronoun")) return "pronoun";
  if (pos.includes("particle")) return "particle";
  if (pos.includes("article")) return "article";
  if (pos.includes("interjection")) return "interjection";
  return null;
}

// ── Rule matching ─────────────────────────────────────────────────────────────

/**
 * Returns true if a word matches all conditions in a rule.
 * AND logic between fields; OR logic within a field's array.
 * A rule with no conditions never matches.
 */
export function matchesColorRule(word: Word, rule: ColorRule): boolean {
  const c = rule.conditions;

  const hasAny = Object.values(c).some((v) => v && v.length > 0);
  if (!hasAny) return false;

  if (c.partOfSpeech?.length) {
    const key = getPosKey(word.partOfSpeech);
    if (!key || !c.partOfSpeech.includes(key)) return false;
  }
  if (c.stem?.length && !c.stem.includes(word.stem ?? "")) return false;
  if (c.tense?.length && !c.tense.includes(word.tense ?? "")) return false;
  if (c.voice?.length && !c.voice.includes(word.voice ?? "")) return false;
  if (c.mood?.length && !c.mood.includes(word.mood ?? "")) return false;
  if (c.person?.length && !c.person.includes(word.person ?? "")) return false;
  if (c.gender?.length && !c.gender.includes(word.gender ?? "")) return false;
  if (c.wordNumber?.length && !c.wordNumber.includes(word.wordNumber ?? "")) return false;
  if (c.verbCase?.length && !c.verbCase.includes(word.verbCase ?? "")) return false;
  if (c.state?.length && !c.state.includes(word.state ?? "")) return false;

  return true;
}

// ── Label generation ──────────────────────────────────────────────────────────

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Auto-generates a human-readable label from selected conditions.
 * E.g. { partOfSpeech: ["verb"], stem: ["qal"], tense: ["perfect"] } → "Verb · Qal · Perfect"
 */
export function generateRuleLabel(conditions: RuleConditions): string {
  const parts: string[] = [];
  for (const vals of Object.values(conditions)) {
    if (vals && vals.length > 0) {
      parts.push(vals.map(cap).join("/"));
    }
  }
  const label = parts.join(" · ");
  return label.length > 42 ? label.slice(0, 40) + "…" : label || "Rule";
}

// ── Palette ───────────────────────────────────────────────────────────────────

export const RULE_PALETTE: string[] = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
];

// ── Field definitions ─────────────────────────────────────────────────────────

export type FieldDef = {
  key: keyof RuleConditions;
  label: string;
  values: string[];
};

export const HEBREW_FIELDS: FieldDef[] = [
  {
    key: "partOfSpeech",
    label: "Part of Speech",
    values: [
      "noun", "verb", "adjective", "adverb", "preposition",
      "conjunction", "pronoun", "particle", "article", "interjection",
    ],
  },
  {
    key: "stem",
    label: "Stem",
    values: [
      "qal", "niphal", "piel", "pual", "hiphil", "hophal", "hithpael",
      "polel", "polal", "hithpolel", "poel", "pilpel", "hishtaphel",
    ],
  },
  {
    key: "tense",
    label: "Aspect",
    values: [
      "perfect", "imperfect", "sequential perfect", "sequential imperfect",
      "imperative", "participle", "infinitive construct", "infinitive absolute", "volitional",
    ],
  },
  { key: "person",     label: "Person", values: ["1", "2", "3"] },
  { key: "gender",     label: "Gender", values: ["masculine", "feminine", "common", "both"] },
  { key: "wordNumber", label: "Number", values: ["singular", "plural", "dual"] },
  { key: "state",      label: "State",  values: ["absolute", "construct", "determined"] },
];

export const GREEK_FIELDS: FieldDef[] = [
  {
    key: "partOfSpeech",
    label: "Part of Speech",
    values: [
      "noun", "verb", "adjective", "adverb", "preposition",
      "conjunction", "pronoun", "particle", "article", "interjection",
    ],
  },
  {
    key: "tense",
    label: "Tense",
    values: ["present", "imperfect", "future", "aorist", "perfect", "pluperfect"],
  },
  { key: "voice", label: "Voice", values: ["active", "middle", "passive"] },
  {
    key: "mood",
    label: "Mood",
    values: ["indicative", "subjunctive", "imperative", "optative", "infinitive", "participle"],
  },
  {
    key: "verbCase",
    label: "Case",
    values: ["nominative", "genitive", "dative", "accusative", "vocative"],
  },
  { key: "person",     label: "Person", values: ["1", "2", "3"] },
  { key: "gender",     label: "Gender", values: ["masculine", "feminine", "neuter"] },
  { key: "wordNumber", label: "Number", values: ["singular", "plural"] },
];
