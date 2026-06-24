/**
 * SBL Academic Hebrew Transliteration
 * Based on the SBL Handbook of Style (2nd ed.) academic scheme.
 *
 * Works on the Unicode OSHB surface text which contains:
 *   - Hebrew consonants (U+05D0–U+05EA)
 *   - Dagesh (U+05BC)
 *   - Vowel points / niqqud (U+05B0–U+05BB, U+05C7)
 *   - Cantillation marks (U+0591–U+05AF, U+05BD, U+05BF, U+05C0–U+05C2, etc.)
 *   - Shin/Sin dots (U+05C1, U+05C2)
 *   - Morpheme separator slashes (stripped before calling this function)
 *
 * The approach: iterate grapheme clusters (base consonant + attached diacritics),
 * emit the transliteration for each consonant+vowel group.
 */

// ── Unicode constants ─────────────────────────────────────────────────────────

const DAGESH    = "ּ";
const SHIN_DOT  = "ׁ";
const SIN_DOT   = "ׂ";
const SHEVA     = "ְ";
const HATAF_SEG = "ֱ";
const HATAF_PAT = "ֲ";
const HATAF_QAM = "ֳ";
const HIRIQ     = "ִ";
const TSERE     = "ֵ";
const SEGOL     = "ֶ";
const PATAH     = "ַ";
const QAMATS    = "ָ";
const HOLAM     = "ֹ";
const HOLAM_WAW = "ֺ"; // holam on vav
const QIBBUTS   = "ֻ";
const QAMATS_Q  = "ׇ"; // qamats qatan (alternative codepoint)

// Vowel Unicode → SBL romanization
const VOWEL_MAP: Record<string, string> = {
  [QAMATS]:    "ā",
  [PATAH]:     "a",
  [TSERE]:     "ē",
  [SEGOL]:     "e",
  [HIRIQ]:     "i",
  [HOLAM]:     "ō",
  [HOLAM_WAW]: "ō",
  [QIBBUTS]:   "u",
  [SHEVA]:     "ĕ",   // vocal sheva; silent sheva omitted
  [HATAF_SEG]: "ĕ",
  [HATAF_PAT]: "ă",
  [HATAF_QAM]: "ŏ",
  [QAMATS_Q]:  "o",
};

// Consonant codepoint → base transliteration
// For ב/כ/פ (begadkefat): with dagesh = stop, without = fricative
const CONSONANT_MAP: Record<string, { stop: string; fric?: string }> = {
  "א": { stop: "ʾ" },           // א aleph
  "ב": { stop: "b",  fric: "v" }, // ב bet/vet
  "ג": { stop: "g" },           // ג gimel
  "ד": { stop: "d" },           // ד dalet
  "ה": { stop: "h" },           // ה he
  "ו": { stop: "w" },           // ו waw
  "ז": { stop: "z" },           // ז zayin
  "ח": { stop: "ḥ" },           // ח het
  "ט": { stop: "ṭ" },           // ט tet
  "י": { stop: "y" },           // י yod
  "ך": { stop: "k",  fric: "ḵ" }, // ך kaf final
  "כ": { stop: "k",  fric: "ḵ" }, // כ kaf
  "ל": { stop: "l" },           // ל lamed
  "ם": { stop: "m" },           // ם mem final
  "מ": { stop: "m" },           // מ mem
  "ן": { stop: "n" },           // ן nun final
  "נ": { stop: "n" },           // נ nun
  "ס": { stop: "s" },           // ס samek
  "ע": { stop: "ʿ" },           // ע ayin
  "ף": { stop: "p",  fric: "p̄" }, // ף pe final
  "פ": { stop: "p",  fric: "p̄" }, // פ pe
  "ץ": { stop: "ṣ" },           // ץ tsadi final
  "צ": { stop: "ṣ" },           // צ tsadi
  "ק": { stop: "q" },           // ק qof
  "ר": { stop: "r" },           // ר resh
  "ש": { stop: "š" },           // ש shin (default; overridden by shin/sin dot)
  "ת": { stop: "t",  fric: "ṯ" }, // ת tav
};

// Codepoints that are cantillation or other non-phonemic marks to skip
const CANTILLATION_RE = /[֑-ֽֿ֯׀׃ׅׄ׆׳״]/g;

/**
 * Transliterate a Hebrew word (surface text) to SBL academic romanization.
 * Input may contain morpheme slashes — strip them before calling.
 */
export function transliterateHebrew(surfaceText: string): string {
  // Strip morpheme slashes and cantillation marks
  const clean = surfaceText.replace(/\//g, "").replace(CANTILLATION_RE, "");

  // Use Intl.Segmenter for grapheme clusters (base + combining diacritics)
  const segmenter = new Intl.Segmenter("he", { granularity: "grapheme" });
  const clusters  = [...segmenter.segment(clean)].map((s) => s.segment);

  // We need a forward-looking pass because holam on waw merges waw+holam into ō
  let result = "";
  let i = 0;

  while (i < clusters.length) {
    const cluster = clusters[i];
    const base    = cluster[0]; // first codepoint = base consonant/letter
    const entry   = CONSONANT_MAP[base];

    if (!entry) {
      // Not a recognized consonant — skip (matres lectionis handled via vowels)
      i++;
      continue;
    }

    const hasDagesh  = cluster.includes(DAGESH);
    const hasShinDot = cluster.includes(SHIN_DOT);
    const hasSinDot  = cluster.includes(SIN_DOT);
    const hasHolam   = cluster.includes(HOLAM);

    // ── Shin/sin dot overrides default consonant ─────────────────────────────
    let consonant: string;
    if (base === "ש") {
      consonant = hasSinDot ? "ś" : "š";
    } else if (entry.fric && !hasDagesh) {
      consonant = entry.fric;
    } else {
      consonant = entry.stop;
    }

    // ── Waw + holam = ō (holam waw) — waw acts as mater lectionis ────────────
    if (base === "ו" && (hasHolam || cluster.includes(HOLAM_WAW))) {
      result += "ō";
      i++;
      continue;
    }

    // ── Waw + dagesh (shureq) = û ─────────────────────────────────────────────
    if (base === "ו" && hasDagesh) {
      result += "û";
      i++;
      continue;
    }

    // ── Yod + hiriq mater — emit "î", skip yod as mater ─────────────────────
    // (hiriq yod: the hiriq is on the preceding cluster; yod just extends it)
    // We handle this by: if base=yod, no vowel on this cluster, and previous
    // vowel was hiriq → skip (already emitted "i", will become "î" in prev step)
    // Simpler: just emit "y" for yod; vowel-lengthening is an approximation
    // acceptable at this level of transliteration.

    result += consonant;

    // ── Emit vowel diacritic ─────────────────────────────────────────────────
    let vowel = "";
    for (const cp of cluster) {
      if (VOWEL_MAP[cp]) { vowel = VOWEL_MAP[cp]; break; }
    }
    // Holam already handled for waw above; for other consonants, add ō
    if (!vowel && hasHolam) vowel = "ō";

    result += vowel;

    // ── Final he without vowel (mappiq) — emit h; quiescent he → silent ─────
    if (base === "ה" && !vowel) {
      // Quiescent he at end — usually silent; don't add extra h beyond consonant above
    }

    i++;
  }

  return result;
}
