/**
 * SBL Academic Greek Transliteration
 * Based on the SBL Handbook of Style (2nd ed.) academic scheme.
 *
 * Input: polytonic Greek Unicode text (SBLGNT).
 * Unicode Greek letters carry combining diacritics:
 *   - Breathing marks: psili/smooth (U+0313), dasia/rough (U+0314)
 *   - Accents: oxia (U+0301), varia (U+0300), perispomeni (U+0342)
 *   - Iota subscript: U+0345
 *   - Diaeresis: U+0308
 *
 * Many Unicode Greek letters are precomposed (NFC); we decompose to NFD to
 * work with base letter + combining marks separately.
 */

const ROUGH_BREATHING = "̔"; // dasia
const IOTA_SUBSCRIPT  = "ͅ";

// Precomposed Greek → decomposed base letter (for cases NFD misses or normalizes oddly)
// We rely on NFD decomposition which handles most cases automatically.

// Base Greek letter (lowercase NFD) → SBL transliteration
const LETTER_MAP: Record<string, string> = {
  α: "a",
  β: "b",
  γ: "g",
  δ: "d",
  ε: "e",
  ζ: "z",
  η: "ē",
  θ: "th",
  ι: "i",
  κ: "k",
  λ: "l",
  μ: "m",
  ν: "n",
  ξ: "x",
  ο: "o",
  π: "p",
  ρ: "r",
  σ: "s",
  ς: "s",
  τ: "t",
  υ: "y",
  φ: "ph",
  χ: "ch",
  ψ: "ps",
  ω: "ō",
};

// Diphthongs that merge υ → u (not y)
const DIPHTHONG_PREV = new Set(["a", "e", "ē", "o", "ō", "u"]);

/**
 * Transliterate a polytonic Greek word to SBL academic romanization.
 */
export function transliterateGreek(text: string): string {
  // Lowercase, then NFD-decompose so diacritics become separate combining chars
  const nfd = text.toLowerCase().normalize("NFD");

  // Intl.Segmenter gives grapheme clusters (base + combining diacritics)
  const segmenter = new Intl.Segmenter("el", { granularity: "grapheme" });
  const clusters  = [...segmenter.segment(nfd)].map((s) => s.segment);

  let result  = "";
  let prevLat = ""; // last Latin letter(s) emitted, for diphthong detection

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    // Base letter is first codepoint in NFD cluster
    const base = cluster[0];

    const entry = LETTER_MAP[base];
    if (!entry) {
      // Punctuation, numerals, etc. — pass through
      result += base;
      prevLat = "";
      continue;
    }

    const hasRough    = cluster.includes(ROUGH_BREATHING);
    const hasIotaSub  = cluster.includes(IOTA_SUBSCRIPT);

    let lat = entry;

    // ── Upsilon in diphthong → u instead of y ────────────────────────────────
    if (base === "υ" && DIPHTHONG_PREV.has(prevLat)) {
      lat = "u";
    }

    // ── Gamma before γ/κ/ξ/χ → n (agma) ─────────────────────────────────────
    if (base === "γ") {
      const nextBase = clusters[i + 1]?.[0];
      if (nextBase === "γ" || nextBase === "κ" || nextBase === "ξ" || nextBase === "χ") {
        lat = "n";
      }
    }

    // ── Rough breathing: prepend h (on word-initial vowel or rho) ───────────
    if (hasRough) {
      lat = "h" + lat;
    }

    result += lat;
    prevLat = lat.replace(/^h/, ""); // don't count leading h for diphthong check

    // ── Iota subscript: append i ──────────────────────────────────────────────
    if (hasIotaSub) {
      result += "i";
      prevLat = "i";
    }
  }

  return result;
}
